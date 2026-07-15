/**
 * Annotation resolver — the read side of W3C Web Annotations for a viewed individual.
 *
 * Given an annotated individual (label + id), returns the notes anchored inside it: each is a Comment whose
 * `oa:hasTarget` is a SpecificResource pointing back at the individual (`oa:hasSource`) through a TextQuoteSelector
 * (`oa:hasSelector`). Two backings, one shape — live via the `annotations` RPC step (authoritative), and offline
 * (`file://` serialized report) via the same reverse walk over the off-heap quad snapshot. `toW3CAnnotations` shapes
 * the result for the annotator library, which anchors each TextQuoteSelector against the rendered body.
 */
import { COMMENT_LABEL, BODY_LABEL, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL, LinkRelations } from "@haibun/core/lib/resources.js";
import { callStep } from "./pane-fetch.js";
import { queryStoredQuads } from "./quads-snapshot.js";

/** A quote that locates a passage in the rendered text. */
export type QuoteAnchor = { exact: string; prefix?: string; suffix?: string };

/** One anchored note: the quote that locates it, the note body, and its provenance. `commentId` is the annotating
 *  Comment (the id the highlight carries, so a click selects the note). */
export type AnnotationView = {
	commentId: string;
	specificResourceId: string;
	exact: string;
	prefix?: string;
	suffix?: string;
	body?: string;
	author?: string;
	generatedAtTime?: string;
	/** A linking annotation's cross-reference: the quote of the section this note points at, so the note can jump to it. */
	linksTo?: QuoteAnchor;
};

/** The W3C Web Annotation the annotator library consumes: a TextualBody plus a target carrying BOTH a TextQuoteSelector
 *  (the durable, content-anchored form persisted in the graph) and a TextPositionSelector (start/end offsets computed
 *  against the rendered text — the annotator library requires both to anchor). `source` is the annotated content's IRI. */
type TextQuoteSelector = { type: "TextQuoteSelector"; exact: string; prefix?: string; suffix?: string };
type TextPositionSelector = { type: "TextPositionSelector"; start: number; end: number };
export type W3CTextAnnotation = {
	"@context": "http://www.w3.org/ns/anno.jsonld";
	id: string;
	type: "Annotation";
	body?: Array<{ type: "TextualBody"; value: string; format?: string }>;
	target: {
		source: string;
		selector: [TextQuoteSelector, TextPositionSelector];
	};
};

type Quad = { subject: string; predicate: string; object: unknown; objectType?: string };

/** Resolve the annotations anchored in (label, id) live, via the `annotations` RPC step. Null when the step is
 *  unavailable (offline, or the registry is momentarily unready) — the caller then chooses the offline walk. The entity
 *  store pairs this with the entity's own resolution: if the entity fetch reached the server, so will this, so there is
 *  no registry race to retry around. */
export async function resolveAnnotationsLive(label: string, id: string): Promise<AnnotationView[] | null> {
	const res = await callStep<{ annotations: AnnotationView[] }>("annotations", { label, id }, `annotation-resolver: ${label}:${id}`);
	return res.ok ? (res.value.annotations ?? []) : null;
}

/** The offline reverse walk over the serialized snapshot: SpecificResource --hasSource--> id, its selector, and each
 *  annotating Comment (--hasTarget--> the SpecificResource) with its markdown body. Pure quad reads; no network. The
 *  genuine path for an offline (`file://`) report, where the RPC never becomes available. */
export async function resolveAnnotationsOffline(id: string): Promise<AnnotationView[]> {
	const srQuads = await queryStoredQuads({ namedGraph: SPECIFIC_RESOURCE_LABEL });
	const bySubject = groupBySubject(srQuads);
	const commentQuads = await queryStoredQuads({ namedGraph: COMMENT_LABEL });
	const commentsBySubject = groupBySubject(commentQuads);

	const out: AnnotationView[] = [];
	for (const [srId, quads] of bySubject) {
		const source = objectOf(quads, LinkRelations.HAS_SOURCE.rel);
		if (source !== id) continue;
		const selectorId = objectOf(quads, LinkRelations.HAS_SELECTOR.rel);
		if (!selectorId) continue;
		const selectorQuads = await queryStoredQuads({ subject: selectorId, namedGraph: TEXT_QUOTE_SELECTOR_LABEL });
		const exact = literalOf(selectorQuads, LinkRelations.EXACT.rel);
		if (exact === undefined) continue;
		const prefix = literalOf(selectorQuads, LinkRelations.PREFIX.rel);
		const suffix = literalOf(selectorQuads, LinkRelations.SUFFIX.rel);

		for (const [commentId, cQuads] of commentsBySubject) {
			if (objectOf(cQuads, LinkRelations.TARGET.rel) !== srId) continue;
			const linksTo = await linkQuoteOf(cQuads);
			out.push({
				commentId,
				specificResourceId: srId,
				exact,
				...(prefix !== undefined ? { prefix } : {}),
				...(suffix !== undefined ? { suffix } : {}),
				...(literalOf(cQuads, LinkRelations.ATTRIBUTED_TO.rel) !== undefined ? { author: literalOf(cQuads, LinkRelations.ATTRIBUTED_TO.rel) } : {}),
				...(literalOf(cQuads, LinkRelations.GENERATED_AT_TIME.rel) !== undefined ? { generatedAtTime: literalOf(cQuads, LinkRelations.GENERATED_AT_TIME.rel) } : {}),
				...(await bodyMarkdownOf(cQuads)),
				...(linksTo ? { linksTo } : {}),
			});
		}
	}
	return out;
}

/** The markdown body of a Comment: its `hasBody` Body sub-resource's content, read from the snapshot. */
async function bodyMarkdownOf(commentQuads: Quad[]): Promise<{ body?: string }> {
	const bodyId = objectOf(commentQuads, LinkRelations.HAS_BODY.rel);
	if (!bodyId) return {};
	const bodyQuads = await queryStoredQuads({ subject: bodyId, namedGraph: BODY_LABEL });
	const content = literalOf(bodyQuads, LinkRelations.CONTENT.rel);
	return content !== undefined ? { body: content } : {};
}

/** The quote of the section a linking Comment points at: Comment —linksTo→ SpecificResource → its TextQuoteSelector. */
async function linkQuoteOf(commentQuads: Quad[]): Promise<QuoteAnchor | undefined> {
	const linkSrId = objectOf(commentQuads, LinkRelations.LINKS_TO.rel);
	if (!linkSrId) return undefined;
	const srQuads = await queryStoredQuads({ subject: linkSrId, namedGraph: SPECIFIC_RESOURCE_LABEL });
	const selectorId = objectOf(srQuads, LinkRelations.HAS_SELECTOR.rel);
	if (!selectorId) return undefined;
	const selQuads = await queryStoredQuads({ subject: selectorId, namedGraph: TEXT_QUOTE_SELECTOR_LABEL });
	const exact = literalOf(selQuads, LinkRelations.EXACT.rel);
	if (exact === undefined) return undefined;
	const prefix = literalOf(selQuads, LinkRelations.PREFIX.rel);
	const suffix = literalOf(selQuads, LinkRelations.SUFFIX.rel);
	return { exact, ...(prefix !== undefined ? { prefix } : {}), ...(suffix !== undefined ? { suffix } : {}) };
}

function groupBySubject(quads: Quad[]): Map<string, Quad[]> {
	const map = new Map<string, Quad[]>();
	for (const q of quads) {
		const list = map.get(q.subject);
		if (list) list.push(q);
		else map.set(q.subject, [q]);
	}
	return map;
}

/** The edge object for a predicate (an objectType-bearing quad — a reference to another individual). */
function objectOf(quads: Quad[], predicate: string): string | undefined {
	const q = quads.find((x) => x.predicate === predicate && x.objectType !== undefined);
	return q ? String(q.object) : undefined;
}

/** The literal value for a predicate (a plain property quad, no objectType). */
function literalOf(quads: Quad[], predicate: string): string | undefined {
	const q = quads.find((x) => x.predicate === predicate && x.objectType === undefined);
	return q ? String(q.object) : undefined;
}

/** Locate a quote within the rendered text, honouring an optional prefix/suffix to pick the right occurrence when the
 *  quote repeats. Null when the quote is not present — the annotator anchors against the text it can see, so a quote
 *  that does not appear in this rendering cannot be highlighted (its note is not shown against the text). */
export function locateQuoteOffsets(text: string, exact: string, prefix?: string, suffix?: string): { start: number; end: number } | null {
	let from = 0;
	for (;;) {
		const idx = text.indexOf(exact, from);
		if (idx < 0) return null;
		const okPrefix = !prefix || text.slice(Math.max(0, idx - prefix.length), idx).endsWith(prefix);
		const okSuffix = !suffix || text.slice(idx + exact.length, idx + exact.length + suffix.length).startsWith(suffix);
		if (okPrefix && okSuffix) return { start: idx, end: idx + exact.length };
		from = idx + 1;
	}
}

/** Shape resolved annotations for the annotator library, anchored against `containerText` (the rendered body text).
 *  Each output carries both the durable TextQuoteSelector and the TextPositionSelector the library requires; an
 *  annotation whose quote is absent from this rendering is omitted (it cannot be highlighted, only listed). */
export function toW3CAnnotations(annotations: AnnotationView[], source: string, containerText: string): W3CTextAnnotation[] {
	const out: W3CTextAnnotation[] = [];
	for (const a of annotations) {
		const pos = locateQuoteOffsets(containerText, a.exact, a.prefix, a.suffix);
		if (!pos) continue;
		out.push({
			"@context": "http://www.w3.org/ns/anno.jsonld",
			id: a.commentId,
			type: "Annotation",
			...(a.body ? { body: [{ type: "TextualBody" as const, value: a.body, format: "text/markdown" }] } : {}),
			target: {
				source,
				selector: [
					{ type: "TextQuoteSelector", exact: a.exact, ...(a.prefix !== undefined ? { prefix: a.prefix } : {}), ...(a.suffix !== undefined ? { suffix: a.suffix } : {}) },
					{ type: "TextPositionSelector", start: pos.start, end: pos.end },
				],
			},
		});
	}
	return out;
}
