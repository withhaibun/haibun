/**
 * The logic engine's reads and writes of the store, the only code of the module that reads it. A reader serves one proof: it
 * reads the facts that hold a pattern's constants once, and a later read of the same constants returns them again.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TQuadPattern } from "@haibun/core/lib/steps/domains/quad-types.js";
import { observedOf } from "@haibun/core/lib/steps/domains/stepper.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { readingAt } from "@haibun/core/lib/domains/capability-context.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { compareSeqPath, factSeqPath } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { equalTo, readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { FACT_LABEL } from "@haibun/core/lib/domains/resources.js";
import { FACT_FIELD } from "@haibun/core/lib/records/domains/facts.js";
import { FACT_POSITIONS, READ_GRAPH, READ_PREDICATE, type TFact } from "../domains/logic.js";
import type { THeldFact } from "../derivations/goals.js";
import { REASONING_READ_CEILING, type TTypeRead } from "../domains/reasoning.js";
import { MAX_PAGE_ROWS, readInPages } from "@haibun/core/lib/domains/hypermedia.js";
import { GraphQuerySchema, isProjectionKey } from "@haibun/core/lib/steps/domains/quad-types.js";
import { recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";

/** A proof's reads: the facts that hold a pattern, a type's records as facts up to the reasoning's ceiling, and the products of
 *  steps as typed records, the latest first. */
export type TReader = { facts: (pattern: TQuadPattern) => Promise<TFact[]>; records: (label: string) => Promise<TTypeRead>; products: () => Promise<THeldFact[]> };

/** A record a read returns as the facts of its fields, each value of a list its own fact, about the id its record IRI states. */
function factsOfRecord(namedGraph: string, record: Record<string, unknown>): TFact[] {
	const named = recordOfIri(record["@id"]);
	if (named === undefined) throw new Error(`a ${namedGraph} record a read returned doesn't state its record IRI as its @id. Read records through a store that names them.`);
	return Object.entries(record).flatMap(([predicate, value]) =>
		isProjectionKey(predicate) || value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((object) => ({ subject: named.id, predicate, object, namedGraph })),
	);
}

/** A reader of the store for one proof. Where `asOf` states a step, it leaves out a fact about the record or a product of a later step. */
export function readerOf(store: IQuadStore, asOf?: readonly number[]): TReader {
	const held = new Map<string, Promise<TFact[]>>();
	const heldAt = ({ subject }: TFact): boolean => {
		const path = asOf === undefined ? null : factSeqPath(subject);
		return path === null || asOf === undefined || compareSeqPath(path, [...asOf]) <= 0;
	};
	return {
		facts: (pattern) => {
			const key = JSON.stringify(FACT_POSITIONS.map((at) => pattern[at]));
			const read = held.get(key);
			if (read !== undefined) return read;
			const reading = store.query(pattern).then((quads) => quads.filter(heldAt));
			held.set(key, reading);
			return reading;
		},
		// A type's records are read in pages through the store's read of records, which every store serves, up to the ceiling.
		records: async (label) => {
			const read = (from: number, to: number) => store.readRecords(GraphQuerySchema.parse({ label, offset: from, limit: to - from, skipCount: true }));
			const { vertices } = await readInPages(read, 0, REASONING_READ_CEILING + 1, MAX_PAGE_ROWS);
			const facts = vertices.slice(0, REASONING_READ_CEILING).flatMap((record) => factsOfRecord(label, record).filter(heldAt));
			return { facts, truncated: vertices.length > REASONING_READ_CEILING };
		},
		// The products are records of their type, held where the steps' records are, so they are read as records, not as quads.
		products: async () =>
			(await readEvery(store, { label: FACT_LABEL }))
				.map((record) => ({ id: String(record[FACT_FIELD.id]), domain: String(record[FACT_FIELD.domain]) }))
				.filter(({ id }) => heldAt({ subject: id, predicate: FACT_FIELD.domain, object: "", namedGraph: FACT_LABEL })),
	};
}

/** The records of a type whose field holds a value, each as its fields by name. */
export const recordsWhere = (store: IQuadStore, label: string, field: string, value: string): Promise<Record<string, unknown>[]> =>
	readEvery(store, { label, filters: equalTo({ [field]: value }) });

/** Each individual as its canonical representative: the first in order of the individuals stated the same as it. */
export async function canonicalOf(reader: TReader): Promise<(individual: string) => string> {
	const classOf = new Map<string, string[]>();
	const held = (one: string): string[] => {
		const found = classOf.get(one);
		return found === undefined ? [one] : found;
	};
	for (const { subject, object } of await reader.facts({ predicate: READ_PREDICATE.sameAs, namedGraph: READ_GRAPH.same })) {
		const joined = [...new Set([...held(subject), ...held(String(object))])].sort();
		for (const one of joined) classOf.set(one, joined);
	}
	return (individual) => itemAt(held(individual), 0);
}

/** Writes a subject's facts in a graph, each field that holds a value, at the read level of its caller so the caller reads
 *  them back. A write outside a call is actuality's own, which reads at private. */
export async function writeFacts(store: IQuadStore, subject: string, namedGraph: string, fields: Record<string, unknown>): Promise<void> {
	const ceiling = readingAt();
	const accessLevel = ceiling === undefined ? Access.private : ceiling;
	for (const { predicate, object } of observedOf(subject, fields)) await store.add({ subject, predicate, object, namedGraph, accessLevel });
}
