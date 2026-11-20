/**
 * The Body an anchor quotes and the digest of its forms. An anchor's writer states the digest of the Body as it read it, and a
 * store's write compares it with the Body the store holds, so an anchor quotes the text its writer read, and an edit of the Body
 * leaves an anchor into its earlier text stale.
 */
import {
	BODY_DIGEST,
	BODY_LABEL,
	BodySchema,
	LinkRelations,
	SOURCE_DIGEST,
	SPECIFIC_RESOURCE_LABEL,
	type TAnchorSource,
	type TPart as TQuotedPart,
	type TQuotedBody,
} from "../../domains/resources.js";
import { isFragment } from "../../domains/media-fragments.js";
import { locateQuoteOffsets } from "../../domains/quote-anchor.js";
import type { TRecordName } from "../domains/unit.js";
import { formsOfBody } from "../derivations/bodies.js";
import { maximalText } from "../derivations/body-text.js";
import type { TPart, TUnitParts } from "../derivations/unit-parts.js";
import { bodyIn, unitBodiesOf } from "./body-reads.js";
import type { TRecordReader } from "./record-reads.js";

/** What a writer reads of a Body it quotes: its id, the digest of its forms, and their text. */
const HeldBodySchema = BodySchema.pick({ id: true, content: true, mediaType: true, representations: true, [BODY_DIGEST]: true });
/** The digest a held Body states. */
const BodyDigestSchema = BodySchema.pick({ [BODY_DIGEST]: true });

/** Returns the digest the fields of the held Body `bodyId` state. Throws where they don't state one, as a Body written before its write
 *  stamped digests doesn't. */
export function heldBodyDigest(bodyId: string, fields: unknown): string {
	const parsed = BodyDigestSchema.safeParse(fields);
	if (!parsed.success) throw new Error(`the Body "${bodyId}" the store holds doesn't state its digest. Write the Body again, so its write stamps the digest`);
	return parsed.data[BODY_DIGEST];
}

/** Returns the Body `body` that `record` holds as a writer quotes it, and the body's fields as its text. Throws where the Body doesn't
 *  state its digest or its text. */
function heldBodyOf(record: TRecordName, body: unknown) {
	const parsed = HeldBodySchema.safeParse(body);
	if (!parsed.success) throw new Error(`a Body of the ${record.label} "${record.id}" doesn't state its text and its digest: ${parsed.error.message}`);
	const quoted: TQuotedBody = { id: parsed.data.id, digest: parsed.data[BODY_DIGEST], forms: formsOfBody(parsed.data).map(({ content }) => content) };
	return { quoted, text: parsed.data };
}

/** Returns the Bodies the store holds of `record`, or the Body `record` is, as a writer quotes them. */
export async function quotedBodiesOf(store: TRecordReader, record: TRecordName): Promise<TQuotedBody[]> {
	return (await unitBodiesOf(store, record.label, record.id)).map((body) => heldBodyOf(record, body).quoted);
}

/** Returns the first Body of `record` that holds a form in the order of `mediaTypes`, as a writer quotes it, with its maximal text
 *  (`maximalText`), which a reader of the record's text reads, or undefined where the record doesn't hold one. One read gives both,
 *  so the text read is the text the Body's digest states. */
export async function quotedTextIn(store: TRecordReader, record: TRecordName, mediaTypes: readonly string[]): Promise<{ quoted: TQuotedBody; text: string } | undefined> {
	const body = bodyIn(await unitBodiesOf(store, record.label, record.id), mediaTypes);
	if (body === undefined) return undefined;
	const { quoted, text } = heldBodyOf(record, body);
	return { quoted, text: maximalText(text) };
}

/** Returns the one Body of `bodies`, which `record` holds, that a part of it names: the Body whose text locates a quote, or the
 *  record's one Body for a fragment of its media. Throws where the part names several of them, or a Body the record doesn't hold. */
export function bodyQuoting(record: TRecordName, bodies: readonly TQuotedBody[], part: TQuotedPart): TAnchorSource {
	const named = isFragment(part) ? bodies : bodies.filter(({ forms }) => forms.some((text) => locateQuoteOffsets(text, part.exact, part.prefix, part.suffix) !== null));
	const [body, ...others] = named;
	if (body === undefined || others.length > 0)
		throw new Error(
			`the ${record.label} "${record.id}" holds ${named.length} Bodies the part ${JSON.stringify(part)} names, and an anchor quotes one Body. Quote the passage with the words around it in one Body`,
		);
	return { id: body.id, digest: body.digest };
}

/** Returns the Body of `bodies`, those `record` holds, whose text a part of the record quotes. A writer that showed a Body states it as
 *  `quoted`, with the digest of the Body as it showed it, which the store compares with the Body it holds as the anchor is written. */
export function anchorSourceOf(record: TRecordName, bodies: readonly TQuotedBody[], part: TQuotedPart, quoted?: TAnchorSource): TAnchorSource {
	if (quoted === undefined) return bodyQuoting(record, bodies, part);
	const { id } = bodyQuoting(
		record,
		bodies.filter((body) => body.id === quoted.id),
		part,
	);
	return { id, digest: quoted.digest };
}

/** Returns the digest of the Body `bodyId` the store holds, or undefined where it doesn't hold the Body. */
export async function heldDigestIn(store: TRecordReader, bodyId: string): Promise<string | undefined> {
	const [body] = await unitBodiesOf(store, BODY_LABEL, bodyId);
	return body === undefined ? undefined : heldBodyDigest(bodyId, body);
}

/** An anchor a unit writes with its source or its digest: the anchor's part, and the record its `hasSource` edge names, where the part
 *  states the edge. */
export type TAnchorWrite = { readonly part: TPart; readonly source: TRecordName | undefined };

/** Returns each anchor `unit` writes with its source or its digest. A store whose write applies a unit without an await reads the
 *  Bodies of the anchors only where the unit writes one. */
export const anchorWrites = (unit: TUnitParts): TAnchorWrite[] =>
	unit.parts.flatMap((part) => {
		if (part.label !== SPECIFIC_RESOURCE_LABEL) return [];
		const source = part.edges.find(({ rel }) => rel === LinkRelations.HAS_SOURCE.rel);
		return source === undefined && part.fields[SOURCE_DIGEST] === undefined ? [] : [{ part, source }];
	});

/** Refuses each anchor `unit` writes whose source isn't a Body, whose source's digest differs from the Body's, or that is written
 *  without its source or without that digest: an anchor's source and digest are written together, so a write can't state a digest
 *  the check doesn't compare. A Body the unit writes states its digest in the unit, as its write stamped it, and each other Body is
 *  read once, through `digestOf`, from the store that writes the unit. */
export async function assertAnchorsCurrent(unit: TUnitParts, anchors: readonly TAnchorWrite[], digestOf: (bodyId: string) => Promise<string | undefined>): Promise<void> {
	const sourced = anchors.map(({ part, source }) => {
		if (source === undefined) throw new Error(`the anchor "${part.id}" is written with a digest and without its source. Write an anchor's source with its digest`);
		if (source.label !== BODY_LABEL)
			throw new Error(`the anchor "${part.id}" names the ${source.label} "${source.id}" as its source. An anchor's source is the Body whose text it quotes`);
		return { part, source };
	});
	const written = new Map(
		unit.parts.flatMap(({ label, id, fields }) => (label === BODY_LABEL && fields[BODY_DIGEST] !== undefined ? [[id, heldBodyDigest(id, fields)] as const] : [])),
	);
	const unread = [...new Set(sourced.map(({ source }) => source.id))].filter((id) => !written.has(id));
	const held = new Map([...written, ...(await Promise.all(unread.map(async (id) => [id, await digestOf(id)] as const)))]);
	for (const { part, source } of sourced) {
		const stated = part.fields[SOURCE_DIGEST];
		if (typeof stated !== "string") throw new Error(`the anchor "${part.id}" into the Body "${source.id}" is written without the Body's digest. State the digest its writer read`);
		const digest = held.get(source.id);
		if (digest === undefined) throw new Error(`the anchor "${part.id}" quotes the Body "${source.id}", which the store doesn't hold. Write the Body before an anchor into it`);
		if (stated !== digest) throw new Error(`the anchor "${part.id}" quotes the Body "${source.id}" as it read before an edit. Read the Body again and anchor the passage in it`);
	}
}
