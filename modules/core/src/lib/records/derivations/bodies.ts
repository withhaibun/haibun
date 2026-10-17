/**
 * A Body's forms and the readings of them a reader opens. The content fields of one kind are the forms of one Body. The
 * Body's text is the form `BODY_PREFERENCE` orders first among those a write holds, and its other forms are its
 * representations.
 */
import { z } from "zod";
import { MEDIA_TYPE } from "../../media-types.js";
import { HAS_BODY_EDGE, isContentPropertyDef, type TPropertyDef, type TRepresentation } from "../../resources.js";
import { LinkedBodySchema, type TLinkedBody } from "../domains/body.js";

/**
 * The order of preference among the forms of one text. Markdown comes first because it carries the structure without the
 * markup. Plain text comes next and the markup last. A Body's text is the first of them it holds, and a reader shown a
 * record reads its preferred reading first.
 */
export const BODY_PREFERENCE: readonly string[] = [MEDIA_TYPE.markdown, MEDIA_TYPE.plain, MEDIA_TYPE.html];

/** The kind of the content fields that don't state one: they hold the forms of the record's one Body. */
export const DEFAULT_BODY_KIND = "default";

/** A content field that holds one form of a Body: the field and the media type of its form. */
export type TBodyForm = { field: string; mediaType: string };

/**
 * Returns the media type of the form a Body's text is: the first of `BODY_PREFERENCE` among `mediaTypes`, or the one media
 * type of a Body of one form. `of` names the Body in a refusal. Throws where `mediaTypes` is empty or names one media type
 * twice, and where a Body of several forms holds a form `BODY_PREFERENCE` doesn't order.
 */
export function preferredMediaType(mediaTypes: readonly string[], of: string): string {
	const [only, ...others] = mediaTypes;
	if (only === undefined) throw new Error(`${of} doesn't hold a form of its text. A Body is written from at least one content field with text`);
	if (new Set(mediaTypes).size !== mediaTypes.length) throw new Error(`${of} holds two forms in one media type (${mediaTypes.join(", ")}). Declare each text in a kind of its own`);
	if (others.length === 0) return only;
	const unordered = mediaTypes.filter((mediaType) => !BODY_PREFERENCE.includes(mediaType));
	const preferred = BODY_PREFERENCE.find((mediaType) => mediaTypes.includes(mediaType));
	if (unordered.length > 0 || preferred === undefined)
		throw new Error(
			`${of} holds the forms ${mediaTypes.join(", ")}, and BODY_PREFERENCE doesn't order ${unordered.join(", ")}, so its text isn't chosen. Declare each such text in a kind of its own`,
		);
	return preferred;
}

/**
 * Returns each Body a type's properties declare, by its kind, with the content field of each of its forms. Throws where a
 * kind's forms don't let `preferredMediaType` choose its text, so a type that declares them is refused where its declaration
 * is read.
 */
export function bodyKindsOf(label: string, properties: Readonly<Record<string, TPropertyDef>>): Map<string, TBodyForm[]> {
	const kinds = new Map<string, TBodyForm[]>();
	for (const [field, def] of Object.entries(properties)) {
		if (!isContentPropertyDef(def)) continue;
		const kind = def.kind === undefined ? DEFAULT_BODY_KIND : def.kind;
		const held = kinds.get(kind);
		const form = { field, mediaType: def.mediaType };
		if (held === undefined) kinds.set(kind, [form]);
		else held.push(form);
	}
	for (const [kind, forms] of kinds)
		preferredMediaType(
			forms.map(({ mediaType }) => mediaType),
			`${label}'s Body "${kind}"`,
		);
	return kinds;
}

/** A Body as a write states it: its text in the form preferred, and each other form as a representation. */
export type TBodyText = { mediaType: string; content: string; representations?: TRepresentation[] };

/** Returns the Body that holds `forms`: its text is the form `preferredMediaType` chooses, and each other form is a
 *  representation. `of` names the Body in a refusal. */
export function bodyOfForms(forms: readonly TRepresentation[], of: string): TBodyText {
	const mediaType = preferredMediaType(
		forms.map((form) => form.mediaType),
		of,
	);
	const text = forms.find((form) => form.mediaType === mediaType);
	if (text === undefined) throw new Error(`${of}'s preferred form ${mediaType} isn't among its forms`);
	const representations = forms.filter((form) => form !== text);
	return representations.length === 0 ? { mediaType, content: text.content } : { mediaType, content: text.content, representations };
}

/** One form of a Body, with its text where the record carries it. */
type TLinkedForm = { mediaType: string; content?: string };

/** Returns each form of a Body: its text, then each representation. A Body without representations holds one form. */
const formsOf = (body: TLinkedBody): TLinkedForm[] => [{ mediaType: body.mediaType, content: body.content }, ...(body.representations === undefined ? [] : body.representations)];

/** Returns the text of a Body's form in the first of `mediaTypes` it holds, or undefined where the Body doesn't carry the
 *  text of one of them. */
export function formIn(body: TLinkedBody, mediaTypes: readonly string[]): string | undefined {
	const forms = formsOf(body);
	return mediaTypes.map((mediaType) => forms.find((form) => form.mediaType === mediaType)?.content).find((content) => content !== undefined);
}

/** One form of one Body as a reader opens it: the key that names it, its Body's id, its media type, and its text where the
 *  record carries it. */
export type TReading = { key: string; body: string; media: string; text?: string };

/** Returns the key of the form of the Body `body` in `media`. A record holds one form of a Body in each media type. */
export const readingKey = (body: string, media: string): string => `${body} ${media}`;

/** Returns the bodies a record links through `hasBody`. Throws for a body that doesn't state its id and media type. */
function linkedBodiesOf(record: Record<string, unknown>): TLinkedBody[] {
	const linked = record[HAS_BODY_EDGE];
	if (linked === undefined) return [];
	return z.array(LinkedBodySchema).parse(Array.isArray(linked) ? linked : [linked]);
}

/** Returns each form of each body a record links, as a reader opens it. Throws for a body that doesn't state its id and
 *  media type. */
export function readingsOf(record: Record<string, unknown>): TReading[] {
	return linkedBodiesOf(record).flatMap((body) =>
		formsOf(body).map(({ mediaType, content }) => ({ key: readingKey(body.id, mediaType), body: body.id, media: mediaType, ...(content === undefined ? {} : { text: content }) })),
	);
}

/** Returns the reading a reader reads first: the first media type of `BODY_PREFERENCE` among the readings with text to
 *  show, or the first such reading where `BODY_PREFERENCE` doesn't order the media type of any. */
export function preferredReading<T extends { media: string; text?: string }>(readings: readonly T[]): T | undefined {
	const usable = readings.filter((reading) => reading.text !== "");
	for (const media of BODY_PREFERENCE) {
		const hit = usable.find((reading) => reading.media === media);
		if (hit !== undefined) return hit;
	}
	return usable[0];
}

/** Returns a record with each body it links that `read` holds, by its id, as the body was read whole, with the text of
 *  each of its forms. */
export function withBodiesRead(record: Record<string, unknown>, read: Readonly<Record<string, TLinkedBody>>): Record<string, unknown> {
	const linked = record[HAS_BODY_EDGE];
	if (!Array.isArray(linked)) return record;
	const asRead = (body: unknown): unknown => {
		const whole = read[LinkedBodySchema.parse(body).id];
		return whole === undefined ? body : whole;
	};
	return { ...record, [HAS_BODY_EDGE]: linked.map(asRead) };
}
