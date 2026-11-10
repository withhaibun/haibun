/**
 * The logic engine's reads and writes of the store, the only code of the module that reads it. A reader serves one proof: it
 * reads the facts that hold a pattern's constants once, and a later read of the same constants returns them again.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TQuadPattern } from "@haibun/core/lib/steps/domains/quad-types.js";
import { Access } from "@haibun/core/lib/domains/resources.js";
import { readingAt } from "@haibun/core/lib/domains/capability-context.js";
import { actualityFeatureOf, calledParts, compareSeqPath, factSeqPath, SEQ_PATH_FIELD, seqPathDomainDefinition } from "@haibun/core/lib/actuality/domains/seq-path.js";
import type { TDomainMembers } from "@haibun/core/lib/domains/resources.js";
import { equalTo, readUpTo, recordMembers } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { FACT_LABEL } from "@haibun/core/lib/domains/resources.js";
import { FACT_FIELD } from "@haibun/core/lib/records/domains/facts.js";
import { FACT_POSITIONS, type TFact } from "../domains/logic.js";
import type { THeldFact } from "../derivations/goals.js";
import { REASONING_READ_CEILING, type TTypeRead } from "../domains/reasoning.js";
import { MAX_PAGE_ROWS, readInPages } from "@haibun/core/lib/domains/hypermedia.js";
import { GraphQuerySchema, isProjectionKey } from "@haibun/core/lib/steps/domains/quad-types.js";
import { recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import { curieOf, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { edgeRanges, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { persistedDomainOf } from "@haibun/core/lib/domains/domains.js";
import type { TField } from "@haibun/core/lib/steps/domains/contract.js";

/** A proof's reads: the facts that hold a pattern, a type's records as facts up to the reasoning's ceiling, and the products of
 *  steps as typed records, the latest first. */
export type TReader = { facts: (pattern: TQuadPattern) => Promise<TFact[]>; records: (label: string) => Promise<TTypeRead>; products: (feature: string) => Promise<THeldFact[]> };

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
		// The products of an actuality feature are records of their type, held where the steps' records are, so they are read as
		// records, not as quads, up to the ceiling.
		products: async (feature) =>
			(await readUpTo(store, { label: FACT_LABEL, filters: equalTo({ [FACT_FIELD.actuality]: feature }) }, REASONING_READ_CEILING))
				.map((record) => ({ id: String(record[FACT_FIELD.id]), domain: String(record[FACT_FIELD.domain]) }))
				.filter(({ id }) => heldAt({ subject: id, predicate: FACT_FIELD.domain, object: "", namedGraph: FACT_LABEL })),
	};
}

/** The feature's step records, as the members of the steps domain: each record's fields, the stepper of the step it called, and
 *  its duration, from its start to its end in milliseconds. */
export const stepMembers: TDomainMembers = recordMembers(
	seqPathDomainDefinition,
	REASONING_READ_CEILING,
	(world) => equalTo({ [SEQ_PATH_FIELD.actuality]: actualityFeatureOf(world.tag) }),
	(record) => {
		const { [SEQ_PATH_FIELD.called]: called, [SEQ_PATH_FIELD.generatedAtTime]: started, [SEQ_PATH_FIELD.endedAtTime]: ended } = record;
		const stepper = typeof called === "string" ? calledParts(called).stepperName : undefined;
		const duration = typeof ended === "string" && typeof started === "string" ? Date.parse(ended) - Date.parse(started) : undefined;
		return { ...record, id: String(record[SEQ_PATH_FIELD.id]), stepper, duration };
	},
);

/** The records of a type whose field holds a value, each as its fields by name. */
export const recordsWhere = (store: IQuadStore, label: string, field: string, value: string): Promise<Record<string, unknown>[]> =>
	readUpTo(store, { label, filters: equalTo({ [field]: value }) }, MAX_PAGE_ROWS);

/** Writes a subject's facts in a graph as one record, each field that holds a value, at the read level of its caller so the caller reads
 *  them back. A write outside a call is actuality's own, which reads at private. */
export async function writeFacts(store: IQuadStore, subject: string, namedGraph: string, fields: Record<string, unknown>): Promise<void> {
	const ceiling = readingAt();
	const accessLevel = ceiling === undefined ? Access.private : ceiling;
	const facts = Object.fromEntries(Object.entries(fields).filter(([, object]) => object !== undefined));
	await store.merge({ "@type": namedGraph, id: subject, ...facts, accessLevel });
}

/** A record a contract's check read: its id and its fields. */
export type TNamedRecord = { readonly id: string; readonly fields: Readonly<Record<string, unknown>> };

/** Reads the records a contract's check names: each record of `names`, and each record that an edge among the fields `follows`
 *  lists reaches from a record read, transitively. Where the store doesn't hold a named record, the read skips it. Throws where a name's type isn't declared,
 *  or a followed edge has more than one range. */
export async function namedRecords(
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	names: readonly TRecordName[],
	follows: readonly TField[],
): Promise<TNamedRecord[]> {
	const visited = new Set<string>();
	const read: TNamedRecord[] = [];
	const visit = async (reaching: readonly TRecordName[]): Promise<void> => {
		const unread = reaching.filter((name) => !visited.has(curieOf(name)));
		unread.forEach((name) => visited.add(curieOf(name)));
		if (unread.length === 0) return;
		const reads = await Promise.all(
			unread.map(async (name) => {
				const domain = persistedDomainOf(domains, name.label);
				if (domain === undefined) throw new Error(`a contract's check names the ${name.label} record ${name.id}, and the loaded steppers don't declare ${name.label}`);
				const record: unknown = await store.readRecord({ label: name.label, schema: domain.schema }, name.id);
				return { name, domain, record: record === undefined ? undefined : (record as Record<string, unknown>) };
			}),
		);
		const reached = reads.flatMap(({ name, domain, record }) => {
			if (record === undefined) return [];
			read.push({ id: name.id, fields: record });
			return follows
				.filter(({ persistedAs }) => persistedAs === name.label)
				.flatMap(({ key }) => {
					const edge = domain.topology.edges?.[key];
					if (edge === undefined) return [];
					const ranges = edgeRanges(edge);
					const [range] = ranges;
					if (range === undefined || ranges.length > 1) throw new Error(`a contract follows ${name.label}.${key}, whose edge doesn't state one range`);
					const value = record[key];
					return (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map((id) => ({ label: range, id: String(id) }));
				});
		});
		await visit(reached);
	};
	await visit(names);
	return read;
}
