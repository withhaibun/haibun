/**
 * Reads records through a store's read function: one record, one record with its edges, the edges that reach a record and
 * the records of a read up to its bound. Reads the quads a read of a store of quads needs. Every caller reads through
 * these functions, so each read states its bound, its count and its order.
 */
import { z } from "zod";
import { digestedFilters, endFieldOf, indexedFields, MAX_PAGE_ROWS, readInPages, type TCounted } from "../../domains/hypermedia.js";
import type { TListItem } from "../../domains/lists.js";
import type { TWorld } from "../../actuality/domains/world.js";
import {
	GraphQuerySchema,
	SortOrderSchema,
	levelOf,
	statedQuery,
	VIA_FIELD,
	type TGraphQuery,
	type TGraphQueryInput,
	type TIncomingEdges,
	type TIndividualWithEdges,
	type TQuad,
	type TQuadEdge,
	type TQuadPattern,
	type TRecordsPage,
	type TSearchCondition,
} from "../../steps/domains/quad-types.js";
import { type IQuadStore } from "../../steps/ports.js";
import { HAS_BODY_EDGE, isPersisted, LinkRelations, type AccessQueryLevel, type TDomainDefinition, type TDomainMembers } from "../../domains/resources.js";
import { readFromRecords, recordsOfQuads, type TReadDeclarations } from "../derivations/read-records.js";

/** The store port's read function. */
export type TRecordReader = Pick<IQuadStore, "readRecords">;

/** Reads the quads that match a pattern. */
type TPatternRead = (pattern: TQuadPattern) => Promise<TQuad[]>;

/** The most records one read of a record's outgoing edges returns. The page states its count, so a record with more edges
 *  states `saturated`. */
export const OUTGOING_EDGE_LIMIT = 200;

/** A record, its outgoing edges, the count of its outgoing edges and the count of the records that reference it. */
export type TRecordWithEdges = TIndividualWithEdges & { outgoingCount: TCounted };

const ViaSchema = z.array(z.string()).min(1);

/** Reads the quads of each subject of each graph that `of` names, with one read of each graph. */
async function quadsOfSubjects(of: ReadonlyArray<{ graph: string; subject: string }>, read: TPatternRead): Promise<TQuad[]> {
	const held = await Promise.all(
		[...Map.groupBy(of, ({ graph }) => graph)].map(async ([namedGraph, named]) => {
			const subjects = new Set(named.map(({ subject }) => subject));
			return (await read({ namedGraph })).filter((quad) => subjects.has(quad.subject));
		}),
	);
	return held.flat();
}

/**
 * Reads the quads a read of a store of quads needs: the named records' quads, the quads of the records that reference a
 * record or that a record references, or the quads of a type. A read that doesn't name one of them doesn't read a quad,
 * and `readFromRecords` refuses it.
 */
export async function quadsOfRead(query: TGraphQuery, read: TPatternRead): Promise<TQuad[]> {
	const { label, named, references, referencedBy } = query;
	if (named && label !== undefined) return (await Promise.all(named.map((subject) => read({ subject, namedGraph: label })))).flat();
	if (references) {
		const pointing = (await read({ object: references.id })).filter((quad) => quad.objectType === references.label);
		return quadsOfSubjects(
			pointing.map((quad) => ({ graph: quad.namedGraph, subject: quad.subject })),
			read,
		);
	}
	if (referencedBy) {
		const source = await read({ subject: referencedBy.id, namedGraph: referencedBy.label });
		const targets = source.flatMap((quad) => (quad.objectType ? [{ graph: quad.objectType, subject: String(quad.object) }] : []));
		return [...source, ...(await quadsOfSubjects(targets, read))];
	}
	return label === undefined ? [] : read({ namedGraph: label });
}

/** Reads a page of the records a store of quads holds, through its pattern read and its declarations. */
export async function readQuadRecords(query: TGraphQuery, read: TPatternRead, declarations: TReadDeclarations): Promise<TRecordsPage> {
	return readFromRecords(recordsOfQuads(await quadsOfRead(query, read)), query, declarations);
}

/** Returns a condition for each field that compares the field's value for equality. */
export function equalTo(fields: Record<string, string>): TSearchCondition[] {
	return Object.entries(fields).map(([predicate, value]) => ({ predicate, operator: "eq", value }));
}

/** Returns an edge for each relation that reaches each record of a reference read. Throws where a record doesn't state the
 *  relations that reach it. */
function edgesOf<D extends TQuadEdge["direction"]>(vertices: ReadonlyArray<Record<string, unknown>>, direction: D): Array<TQuadEdge & { direction: D }> {
	return vertices.flatMap(({ [VIA_FIELD]: via, ...target }) => ViaSchema.parse(via).map((type) => ({ type, direction, target })));
}

/** Reads one record by its type and id. Returns undefined where the store doesn't hold the record at the level. */
export async function recordOf(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<Record<string, unknown> | undefined> {
	const page = await store.readRecords(GraphQuerySchema.parse({ label, named: [id], limit: 1, skipCount: true, ...levelOf(accessLevel) }));
	return page.vertices[0];
}

/**
 * Reads one record with its edges in three reads: the named record, the records it references with the relations that reach
 * each, and the count of the records that reference it. Returns undefined where the store doesn't hold the record at the
 * level. The outgoing edges state their count, so a record with more than `OUTGOING_EDGE_LIMIT` edges states `saturated`.
 * The record lists the bodies its edges reach in `hasBody`. A view renders a record's text from that list.
 */
export async function recordWithEdges(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<TRecordWithEdges | undefined> {
	const level = levelOf(accessLevel);
	const [named, outgoing, incoming] = await Promise.all([
		store.readRecords(GraphQuerySchema.parse({ label, named: [id], limit: 1, skipCount: true, ...level })),
		store.readRecords(GraphQuerySchema.parse({ referencedBy: { label, id }, limit: OUTGOING_EDGE_LIMIT, ...level })),
		store.readRecords(GraphQuerySchema.parse({ references: { label, id }, limit: 1, ...level })),
	]);
	const [held] = named.vertices;
	if (!held) return undefined;
	const edges = edgesOf(outgoing.vertices, "out");
	const bodies = edges.filter(({ type }) => type === LinkRelations.HAS_BODY.rel).map(({ target }) => target);
	const vertex = bodies.length > 0 ? { ...held, [HAS_BODY_EDGE]: bodies } : held;
	return { vertex, edges, incomingCount: { total: incoming.total, saturated: incoming.saturated }, outgoingCount: { total: outgoing.total, saturated: outgoing.saturated } };
}

/** Reads a page of the edges that reach one record, an edge for each relation of each record that references it. The count
 *  counts each referencing record once. */
export async function incomingEdges(
	store: TRecordReader,
	label: string,
	id: string,
	window: { limit: number; offset: number },
	accessLevel?: AccessQueryLevel,
): Promise<TIncomingEdges> {
	const page = await store.readRecords(GraphQuerySchema.parse({ references: { label, id }, ...window, ...levelOf(accessLevel) }));
	return { edges: edgesOf(page.vertices, "in"), total: page.total, saturated: page.saturated };
}

/** Reads the records of a read, a page at a time from the read's offset, up to `bound` records. Throws where the store holds
 *  more than `bound` records of the read, since a caller that acted on part of what it reads would act on part of the records,
 *  and throws for a `perType` read, which states the first records of each type. */
export async function readUpTo(store: TRecordReader, input: TGraphQueryInput, bound: number): Promise<Record<string, unknown>[]> {
	const query = GraphQuerySchema.parse(input);
	if (query.perType !== undefined) throw new Error("readUpTo reads the records of a read, and a perType read states the first records of each type");
	const { offset } = statedQuery(query);
	const read = (from: number, to: number) => store.readRecords({ ...query, offset: from, limit: to - from, skipCount: true });
	const { vertices } = await readInPages(read, offset, offset + bound + 1, MAX_PAGE_ROWS);
	if (vertices.length > bound)
		throw new Error(`the read of ${query.label === undefined ? "records" : query.label} holds more than its bound of ${bound} records; narrow it by a field, an edge or a level`);
	return vertices;
}

/**
 * The members of a persisted type that a quantifier ranges over: its records that ended by the quantifier's start, under the
 * conditions `scope` states in the world, as the query's filters and order select them, up to `bound`, each the item `item` makes
 * of its record. A list query's offset and limit apply to the members the read returns.
 */
export function recordMembers(
	type: TDomainDefinition,
	bound: number,
	scope: (world: TWorld) => TSearchCondition[],
	item: (record: Record<string, unknown>) => TListItem,
): TDomainMembers {
	const { topology } = type;
	if (!isPersisted(topology)) throw new Error(`${type.selectors.join(", ")} doesn't persist its records, so a quantifier can't range over them`);
	return {
		indexed: indexedFields(topology),
		read: async (world, endedBy, { filters, order }) => {
			const stated = filters === undefined ? [] : filters;
			const sorted = order === undefined ? {} : { sortBy: order.field, sortOrder: order.descending ? SortOrderSchema.enum.desc : SortOrderSchema.enum.asc };
			const read = { filters: [...scope(world), ...digestedFilters(topology, stated)], ...sorted };
			// A digest can be another text's too, so a record whose digested text differs from the filter's isn't a member.
			const digested = stated.filter(({ predicate }) => topology.digests?.[predicate] !== undefined);
			const records = await readEndedBy(world.shared.getStore(), type, endedBy, read, bound);
			return records.filter((record) => digested.every(({ predicate, value }) => record[predicate] === value)).map(item);
		},
	};
}

/** Reads every record of a type that ended at or before `at`, an epoch time in milliseconds, under the read's conditions. An
 *  observation source reads these for a step that started at `at`, so the step doesn't read its own record, its parts or a later
 *  step. Throws for a type that doesn't persist its records. */
export function readEndedBy(store: TRecordReader, type: TDomainDefinition, at: number, read: Omit<TGraphQueryInput, "label">, bound: number): Promise<Record<string, unknown>[]> {
	const { topology } = type;
	if (!isPersisted(topology)) throw new Error(`${type.selectors.join(", ")} doesn't persist its records, so a read can't bound them by when they ended`);
	const ended: TSearchCondition = { predicate: endFieldOf(topology), operator: "lte", value: new Date(at).toISOString() };
	return readUpTo(store, { ...read, label: topology.persistedAs, filters: [...(read.filters === undefined ? [] : read.filters), ended] }, bound);
}
