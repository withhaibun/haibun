/**
 * Reads the bodies of records through a store's read function: one record's bodies with their text, the text of a form of a
 * record's body in a media type, and a record's markdown.
 */
import { GraphQuerySchema } from "../../steps/domains/quad-types.js";
import { type IQuadStore } from "../../steps/ports.js";
import { BODY_LABEL, LinkRelations, type AccessQueryLevel } from "../../resources.js";
import { MEDIA_TYPE } from "../../media-types.js";
import { LinkedBodySchema, type TLinkedBody } from "../domains/body.js";
import { formIn } from "../derivations/bodies.js";
import { levelOf, OUTGOING_EDGE_LIMIT, readEvery, recordOf, type TRecordReader } from "./record-reads.js";

/** Reads the bodies of one record with their text, in two reads: the bodies its edges reach, and those bodies by id. A page
 *  of bodies doesn't hold their text, and a read of named bodies holds it. */
export async function bodiesOf(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<TLinkedBody[]> {
	const level = levelOf(accessLevel);
	const linked = await store.readRecords(GraphQuerySchema.parse({ referencedBy: { label, id }, label: BODY_LABEL, limit: OUTGOING_EDGE_LIMIT, skipCount: true, ...level }));
	const named = linked.vertices.map((body) => LinkedBodySchema.parse(body).id);
	if (named.length === 0) return [];
	const read = await store.readRecords(GraphQuerySchema.parse({ label: BODY_LABEL, named, limit: named.length, skipCount: true, ...level }));
	return read.vertices.map((body) => LinkedBodySchema.parse(body));
}

/** Reads the text of one record's first form of a body in the order of `mediaTypes`: a body's text or one of its
 *  representations. Returns undefined where the record doesn't hold a form in one of them. */
export async function bodyByMediaTypes(
	store: TRecordReader,
	record: { label: string; id: string },
	mediaTypes: readonly string[],
	accessLevel?: AccessQueryLevel,
): Promise<string | undefined> {
	const bodies = await bodiesOf(store, record.label, record.id, accessLevel);
	return mediaTypes.map((mediaType) => bodies.map((body) => formIn(body, [mediaType])).find((text) => text !== undefined)).find((text) => text !== undefined);
}

/** Reads the text of one record's form of a body in a media type. Returns undefined where the record doesn't hold a form
 *  in that media type. */
export function bodyByMediaType(store: TRecordReader, record: { label: string; id: string }, mediaType: string, accessLevel?: AccessQueryLevel): Promise<string | undefined> {
	return bodyByMediaTypes(store, record, [mediaType], accessLevel);
}

/** Reads the text of the form in `mediaType` of a body of each record of `label` that `ids` names, in two reads: the body
 *  edges of the type, and the bodies those edges reach from `ids` by id. Returns the text by the id of each record that
 *  holds a form in that media type, the first where it holds several, as `bodyByMediaType` reads one record's. */
export async function bodiesByMediaType(store: Pick<IQuadStore, "readRecords" | "query">, label: string, ids: readonly string[], mediaType: string): Promise<Map<string, string>> {
	const named = new Set(ids);
	const recordOfBody = new Map<string, string>();
	for (const { subject, object } of await store.query({ predicate: LinkRelations.HAS_BODY.rel, namedGraph: label }))
		if (named.has(String(subject))) recordOfBody.set(String(object), String(subject));
	const texts = new Map<string, string>();
	if (recordOfBody.size === 0) return texts;
	for (const body of await readEvery(store, { label: BODY_LABEL, named: [...recordOfBody.keys()] })) {
		const read = LinkedBodySchema.parse(body);
		const record = recordOfBody.get(read.id);
		const text = formIn(read, [mediaType]);
		if (record !== undefined && text !== undefined && !texts.has(record)) texts.set(record, text);
	}
	return texts;
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
