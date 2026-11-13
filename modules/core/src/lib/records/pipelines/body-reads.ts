/**
 * Reads the bodies of records through a store's read function: one record's bodies with their text, the text of a form of a
 * record's body in a media type, a body's maximal text, and a record's markdown.
 */
import { type IQuadStore } from "../../steps/ports.js";
import { BODY_LABEL, LinkRelations, type AccessQueryLevel } from "../../domains/resources.js";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { BodyTextSchema, LinkedBodySchema, type TLinkedBody } from "../domains/body.js";
import { formIn, linkedBodiesOf } from "../derivations/bodies.js";
import { maximalText } from "../derivations/body-text.js";
import { readUpTo, unitOf, type TRecordReader } from "./record-reads.js";

/** Reads the bodies of one record, with their text, in one read of the record's unit: the bodies it owns, or a Body itself. Returns
 *  an empty list where the store doesn't hold the record at the level. */
export async function unitBodiesOf(store: TRecordReader, label: string, id: string, accessLevel?: AccessQueryLevel): Promise<TLinkedBody[]> {
	const unit = await unitOf(store, label, id, accessLevel);
	if (unit === undefined) return [];
	return label === BODY_LABEL ? [LinkedBodySchema.parse({ ...unit, id })] : linkedBodiesOf(unit);
}

/** Returns the first of `bodies` that holds a form in the first of `mediaTypes` any of them holds. */
const bodyIn = (bodies: readonly TLinkedBody[], mediaTypes: readonly string[]): TLinkedBody | undefined =>
	mediaTypes.map((mediaType) => bodies.find((body) => formIn(body, [mediaType]) !== undefined)).find((body) => body !== undefined);

/** Reads the text of one record's first form of a body in the order of `mediaTypes`: a body's text or one of its
 *  representations. Returns undefined where the record doesn't hold a form in one of them. */
export async function bodyByMediaTypes(
	store: TRecordReader,
	record: { label: string; id: string },
	mediaTypes: readonly string[],
	accessLevel?: AccessQueryLevel,
): Promise<string | undefined> {
	const body = bodyIn(await unitBodiesOf(store, record.label, record.id, accessLevel), mediaTypes);
	return body === undefined ? undefined : formIn(body, mediaTypes);
}

/** Reads the maximal text of one record's first body that holds a form in the order of `mediaTypes`: the body's text, with
 *  each line of its other forms that holds a word its text doesn't (`maximalText`). A reader that forwards a record's text
 *  reads it, so the text it sends holds what each form holds. Returns undefined where the record doesn't hold a form in one
 *  of them. */
export async function maximalTextIn(store: TRecordReader, record: { label: string; id: string }, mediaTypes: readonly string[]): Promise<string | undefined> {
	const body = bodyIn(await unitBodiesOf(store, record.label, record.id), mediaTypes);
	return body === undefined ? undefined : maximalText(BodyTextSchema.parse(body));
}

/** Reads the text of one record's form of a body in a media type. Returns undefined where the record doesn't hold a form
 *  in that media type. */
export function bodyByMediaType(store: TRecordReader, record: { label: string; id: string }, mediaType: string, accessLevel?: AccessQueryLevel): Promise<string | undefined> {
	return bodyByMediaTypes(store, record, [mediaType], accessLevel);
}

/** Reads the text of the form in `mediaType` of a body of each record of `label` that `ids` names: the body edges of each
 *  record, read by its id, and the bodies those edges reach, in one read by id. Returns the text by the id of each record
 *  that holds a form in that media type, the first where it holds several, as `bodyByMediaType` reads one record's. */
export async function bodiesByMediaType(store: Pick<IQuadStore, "readRecords" | "query">, label: string, ids: readonly string[], mediaType: string): Promise<Map<string, string>> {
	const edges = await Promise.all([...new Set(ids)].map((id) => store.query({ subject: id, predicate: LinkRelations.HAS_BODY.rel, namedGraph: label })));
	return bodyTextsOf(store, new Map(edges.flat().map(({ subject, object }) => [String(object), String(subject)])), mediaType);
}

/** Reads the bodies `recordOfBody` names, in one read by id, and returns the text of each body's form in `mediaType` by the
 *  id of the record `recordOfBody` states for it, the first where a record holds several. A record has text only from a
 *  body the read returns at the level in force that holds a form in that media type. */
export async function bodyTextsOf(store: TRecordReader, recordOfBody: ReadonlyMap<string, string>, mediaType: string): Promise<Map<string, string>> {
	const texts = new Map<string, string>();
	if (recordOfBody.size === 0) return texts;
	for (const body of await readUpTo(store, { label: BODY_LABEL, named: [...recordOfBody.keys()] }, recordOfBody.size)) {
		const read = LinkedBodySchema.parse(body);
		const record = recordOfBody.get(read.id);
		const text = formIn(read, [mediaType]);
		if (record !== undefined && text !== undefined && !texts.has(record)) texts.set(record, text);
	}
	return texts;
}

/** Reads one record's markdown text: the form in markdown of a Body it owns. Returns undefined where the store doesn't hold the
 *  record or its markdown. */
export const markdownOf = (store: TRecordReader, label: string, id: string): Promise<string | undefined> => bodyByMediaType(store, { label, id }, MEDIA_TYPE.markdown);
