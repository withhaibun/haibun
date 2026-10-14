/**
 * Reads records through a store's read function: one record, one record with its edges, the edges that reach a record, a
 * record's bodies and every record of a read. Reads the quads a read of a store of quads needs. Every caller reads through
 * these functions, so each read states its bound, its count and its order.
 */
import { z } from "zod";
import { MAX_PAGE_ROWS, readInPages, type TCounted } from "../../hypermedia.js";
import { GraphQuerySchema, statedQuery, VIA_FIELD, type TGraphQuery, type TGraphQueryInput, type TIncomingEdges, type TIndividualWithEdges, type TQuad, type TQuadEdge, type TQuadPattern, type TRecordsPage, type TSearchCondition } from "../../steps/domains/quad-types.js";
import { type IQuadStore } from "../../steps/ports.js";
import { BODY_LABEL, HAS_BODY_EDGE, LinkRelations, type AccessQueryLevel } from "../../resources.js";
import { MEDIA_TYPE } from "../../media-types.js";
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

const RecordBodySchema = z.looseObject({ id: z.string(), mediaType: z.string(), content: z.string().optional() });
/** A body of a record: its id, its media type and its text, where the read returns the text. */
export type TRecordBody = z.infer<typeof RecordBodySchema>;

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

const levelOf = (accessLevel: AccessQueryLevel | undefined) => (accessLevel === undefined ? {} : { accessLevel });

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

/** Reads the bodies of one record with their text, in two reads: the bodies its edges reach, and those bodies by id. A page
 *  of bodies doesn't hold their text, and a read of named bodies holds it. */
export async function bodiesOf(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<TRecordBody[]> {
	const level = levelOf(accessLevel);
	const linked = await store.readRecords(GraphQuerySchema.parse({ referencedBy: { label, id }, label: BODY_LABEL, limit: OUTGOING_EDGE_LIMIT, skipCount: true, ...level }));
	const named = linked.vertices.map((body) => RecordBodySchema.parse(body).id);
	if (named.length === 0) return [];
	const read = await store.readRecords(GraphQuerySchema.parse({ label: BODY_LABEL, named, limit: named.length, skipCount: true, ...level }));
	return read.vertices.map((body) => RecordBodySchema.parse(body));
}

/** Reads the text of one record's first body in the order of `mediaTypes`. Returns undefined where the record doesn't hold
 *  a body of one of them. */
export async function bodyByMediaTypes(
	store: TRecordReader,
	record: { label: string; id: string },
	mediaTypes: readonly string[],
	accessLevel?: AccessQueryLevel,
): Promise<string | undefined> {
	const bodies = await bodiesOf(store, record.label, record.id, accessLevel);
	return mediaTypes.map((mediaType) => bodies.find((body) => body.mediaType === mediaType)?.content).find((content) => content !== undefined);
}

/** Reads the text of one record's body in a media type. Returns undefined where the record doesn't hold a body of that
 *  media type. */
export function bodyByMediaType(store: TRecordReader, record: { label: string; id: string }, mediaType: string, accessLevel?: AccessQueryLevel): Promise<string | undefined> {
	return bodyByMediaTypes(store, record, [mediaType], accessLevel);
}

/**
 * Reads one record's markdown text. Returns the record's `body` or `content` field where the store holds the text in the
 * record, and the record's markdown body otherwise. Returns undefined where the store doesn't hold the record or its
 * markdown.
 */
export async function markdownOf(store: TRecordReader, label: string, id: string): Promise<string | undefined> {
	const held = await recordOf(store, label, id);
	if (!held) return undefined;
	const inline = held.body ?? held.content;
	if (typeof inline === "string") return inline;
	return bodyByMediaType(store, { label, id }, MEDIA_TYPE.markdown);
}

/** Reads every record of a read, a page at a time from the read's offset to the first short page. Throws for a `perType` read,
 *  since it states the first records of each type. */
export async function readEvery(store: TRecordReader, input: TGraphQueryInput): Promise<Record<string, unknown>[]> {
	const query = GraphQuerySchema.parse(input);
	if (query.perType !== undefined) throw new Error("readEvery reads every record of a read, and a perType read states the first records of each type");
	const read = (from: number, to: number) => store.readRecords({ ...query, offset: from, limit: to - from, skipCount: true });
	return (await readInPages(read, statedQuery(query).offset, Number.POSITIVE_INFINITY, MAX_PAGE_ROWS)).vertices;
}
