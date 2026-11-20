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
import { equalTo, outgoingEdgesOf, readUpTo, recordMembers } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { FACT_LABEL } from "@haibun/core/lib/domains/resources.js";
import { FACT_FIELD } from "@haibun/core/lib/records/domains/facts.js";
import { FACT_POSITIONS, type TFact } from "../domains/logic.js";
import type { THeldFact } from "../derivations/goals.js";
import { REASONING_READ_CEILING, type TTypeRead } from "../domains/reasoning.js";
import { MAX_PAGE_ROWS, readInPages } from "@haibun/core/lib/domains/hypermedia.js";
import { GraphQuerySchema, isProjectionKey } from "@haibun/core/lib/steps/domains/quad-types.js";
import { recordOfIri } from "@haibun/core/lib/records/derivations/record-iri.js";
import { curieOf, NODE_KEY, referenceTo, type TRecordName } from "@haibun/core/lib/records/domains/unit.js";
import { topologyEdges, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { persistedDomainOf } from "@haibun/core/lib/domains/domains.js";
import type { TField } from "@haibun/core/lib/steps/domains/contract.js";

/** A proof's reads: the facts that hold a pattern, a type's records as facts up to the reasoning's ceiling, and the products of
 *  steps as typed records, the latest first. */
type TReader = { facts: (pattern: TQuadPattern) => Promise<TFact[]>; records: (label: string) => Promise<TTypeRead>; products: (feature: string) => Promise<THeldFact[]> };

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

/** A record a contract's check read: its name and its fields. */
export type TNamedRecord = { readonly name: TRecordName; readonly fields: Readonly<Record<string, unknown>> };

/** Returns the records the edges `keys` of the record `name` reach, as the store holds the edges: each by the edge's key, its type,
 *  which the store states of each target, and its id, by the field the type declares its id. */
async function edgeTargets(
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	name: TRecordName,
	keys: readonly string[],
): Promise<Array<TRecordName & { key: string }>> {
	return (await outgoingEdgesOf(store, name.label, name.id)).flatMap(({ type, target }) => {
		if (!keys.includes(type)) return [];
		const label = String(target[NODE_KEY.type]);
		const domain = persistedDomainOf(domains, label);
		if (domain === undefined) throw new Error(`a contract follows ${name.label}.${type} to a ${label} record, and the loaded steppers don't declare ${label}`);
		return [{ key: type, label, id: String(target[domain.topology.id]) }];
	});
}

/** Reads the records a contract's check names: each record of `names`, and each record that an edge among the fields `follows`
 *  lists reaches from a record read, transitively, as the store holds each edge, with the record each edge reaches as a reference
 *  among the fields of the record that holds it. Where the store doesn't hold a named record, the read skips it. Throws where a
 *  name's type isn't declared, or an edge reaches a record of a type that isn't. */
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
		const reached = await Promise.all(
			reads.map(async ({ name, domain, record }) => {
				if (record === undefined) return [];
				// A field the contract states complete is read with the record; an edge is followed to the records it reaches.
				const edges = topologyEdges(domain.topology);
				const followed = follows.filter(({ persistedAs, key }) => persistedAs === name.label && edges[key] !== undefined).map(({ key }) => key);
				const targets = followed.length === 0 ? [] : await edgeTargets(store, domains, name, followed);
				// A record's followed edges are facts of it, each a reference to the record it reaches, as the store holds the edge.
				const reaching = Object.fromEntries(followed.map((key) => [key, targets.filter((target) => target.key === key).map(({ label, id }) => referenceTo(label, id))]));
				read.push({ name, fields: { ...record, ...reaching } });
				return targets.map(({ label, id }) => ({ label, id }));
			}),
		);
		await visit(reached.flat());
	};
	await visit(names);
	return read;
}
