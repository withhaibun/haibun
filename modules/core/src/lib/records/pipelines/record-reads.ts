/**
 * Reads records through a store's read function: one record, one record with its edges, and every record of a read. Reads the
 * quads a read of a store of quads needs. Every caller reads through these functions, so each read states its bound, its
 * count and its order.
 */
import { z } from "zod";
import { readInPages, type TCounted } from "../../hypermedia.js";
import { GraphQuerySchema, VIA_FIELD, type IQuadStore, type TGraphQuery, type TIndividualWithEdges, type TQuad, type TQuadPattern, type TRecordsPage } from "../../quad-types.js";
import type { AccessQueryLevel } from "../../resources.js";
import { readFromRecords, recordsOfQuads, type TReadDeclarations } from "../derivations/read-records.js";

/** The store port's read function. */
type TRecordReader = Pick<IQuadStore, "readRecords">;

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
	const byGraph = new Map<string, Set<string>>();
	for (const { graph, subject } of of) byGraph.set(graph, (byGraph.get(graph) ?? new Set()).add(subject));
	const held = await Promise.all([...byGraph].map(async ([namedGraph, subjects]) => (await read({ namedGraph })).filter((quad) => subjects.has(quad.subject))));
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

const levelOf = (accessLevel: AccessQueryLevel | undefined) => (accessLevel === undefined ? {} : { accessLevel });

/** Reads one record by its type and id. Returns undefined where the store doesn't hold the record at the level. */
export async function recordOf(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<Record<string, unknown> | undefined> {
	const page = await store.readRecords(GraphQuerySchema.parse({ label, named: [id], limit: 1, skipCount: true, ...levelOf(accessLevel) }));
	return page.vertices[0];
}

/**
 * Reads one record with its edges in three reads: the named record, the records it references with the relations that reach
 * each, and the count of the records that reference it. Returns undefined where the store doesn't hold the record at the
 * level. The outgoing edges state their count, so a record with more than `OUTGOING_EDGE_LIMIT` edges states `saturated`.
 */
export async function recordWithEdges(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<TRecordWithEdges | undefined> {
	const level = levelOf(accessLevel);
	const [named, outgoing, incoming] = await Promise.all([
		store.readRecords(GraphQuerySchema.parse({ label, named: [id], limit: 1, skipCount: true, ...level })),
		store.readRecords(GraphQuerySchema.parse({ referencedBy: { label, id }, limit: OUTGOING_EDGE_LIMIT, ...level })),
		store.readRecords(GraphQuerySchema.parse({ references: { label, id }, limit: 1, ...level })),
	]);
	const [vertex] = named.vertices;
	if (!vertex) return undefined;
	const edges = outgoing.vertices.flatMap(({ [VIA_FIELD]: via, ...target }) => ViaSchema.parse(via).map((type) => ({ type, direction: "out" as const, target })));
	return { vertex, edges, incomingCount: { total: incoming.total, saturated: incoming.saturated }, outgoingCount: { total: outgoing.total, saturated: outgoing.saturated } };
}

/** Reads every record of a read, a page at a time from the read's offset to the first short page. Throws for a `perType` read,
 *  since it states the first records of each type. */
export async function readEvery(store: TRecordReader, query: TGraphQuery): Promise<Record<string, unknown>[]> {
	if (query.perType !== undefined) throw new Error("readEvery reads every record of a read, and a perType read states the first records of each type");
	const read = (from: number, to: number) => store.readRecords({ ...query, offset: from, limit: to - from, skipCount: true });
	return (await readInPages(read, query.offset, Number.POSITIVE_INFINITY)).vertices;
}
