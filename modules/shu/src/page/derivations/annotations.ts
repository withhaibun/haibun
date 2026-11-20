/**
 * The notes anchored in a record, as the annotator library reads them, and the reads of the quads that describe a note.
 * A note is a Comment whose `oa:hasTarget` is a SpecificResource that points back at the record (`oa:hasSource`) through a
 * TextQuoteSelector (`oa:hasSelector`).
 */
import { ANCHOR_STATE, anchorStateOf } from "@haibun/core/lib/domains/quote-anchor.js";
import type { TTextRange } from "@haibun/core/lib/domains/quote-anchor.js";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import { SPECIFIC_RESOURCE_LABEL, type TAnchorSource, type TAnnotationView, type TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

/** The W3C Web Annotation the annotator library reads: a TextualBody, and a target that carries both a TextQuoteSelector
 *  (the content-anchored form the graph holds) and a TextPositionSelector (the offsets in the rendered text, which the
 *  library requires to anchor). `source` is the annotated content's IRI. */
/** The Web Annotation Data Model's JSON-LD context. */
const ANNOTATION_CONTEXT = "http://www.w3.org/ns/anno.jsonld";
type TTextQuoteSelector = { type: "TextQuoteSelector"; exact: string; prefix?: string; suffix?: string };
type TTextPositionSelector = { type: "TextPositionSelector"; start: number; end: number };
export type TW3CTextAnnotation = {
	"@context": typeof ANNOTATION_CONTEXT;
	id: string;
	type: "Annotation";
	body?: Array<{ type: "TextualBody"; value: string; format?: string }>;
	target: { source: string; selector: [TTextQuoteSelector, TTextPositionSelector] };
};

/** The notes of a record anchored in one of its Bodies, by their state: current where they quote the Body as it reads now, and
 *  stale where the Body changed after they quoted it. */
export type TNotesIn = { readonly current: TAnnotationView[]; readonly stale: TAnnotationView[] };

/** Returns the notes of `annotations` anchored in the Body `quoted`, by their state. A note on another Body of the record isn't one
 *  of them, since the view shows the text of `quoted` alone. */
export function notesIn(annotations: readonly TAnnotationView[], quoted: TAnchorSource): TNotesIn {
	const inBody = annotations.filter(({ source }) => source === quoted.id);
	const stateOf = ({ sourceDigest }: TAnnotationView) => anchorStateOf(sourceDigest, quoted.digest);
	return { current: inBody.filter((note) => stateOf(note) === ANCHOR_STATE.current), stale: inBody.filter((note) => stateOf(note) === ANCHOR_STATE.stale) };
}

/** Returns the notes as the annotator library reads them, each at the range of the rendered body text `locate` places its quote. A
 *  note whose quote the rendering doesn't hold is left out, since a highlight can't mark it; the note list still shows it. */
export function toW3CAnnotations(annotations: TAnnotationView[], source: string, locate: (quote: TQuoteAnchor) => TTextRange | null): TW3CTextAnnotation[] {
	const out: TW3CTextAnnotation[] = [];
	for (const a of annotations) {
		const pos = locate(a);
		if (!pos) continue;
		out.push({
			"@context": ANNOTATION_CONTEXT,
			id: a.commentId,
			type: "Annotation",
			...(a.body ? { body: [{ type: "TextualBody" as const, value: a.body, format: MEDIA_TYPE.markdown }] } : {}),
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

/** Returns the quads by their subject. */
export function bySubject(quads: TQuad[]): Map<string, TQuad[]> {
	const map = new Map<string, TQuad[]>();
	for (const q of quads) {
		const list = map.get(q.subject);
		if (list) list.push(q);
		else map.set(q.subject, [q]);
	}
	return map;
}

/** Returns the record an edge of `predicate` reaches: the object of the quad that carries an object type. */
export function edgeOf(quads: TQuad[], predicate: string): string | undefined {
	const q = quads.find((x) => x.predicate === predicate && x.objectType !== undefined);
	return q ? String(q.object) : undefined;
}

/** Returns the value of the property `predicate`: the object of the quad without an object type. */
export function literalOf(quads: TQuad[], predicate: string): string | undefined {
	const q = quads.find((x) => x.predicate === predicate && x.objectType === undefined);
	return q ? String(q.object) : undefined;
}

/** Returns the address of a note's anchor, the record that states the passage it quotes, the Body it quotes and the digest of the
 *  Body as it quoted it. */
export const anchorOf = (note: TAnnotationView): TIndividualAddress => ({ persistedAs: SPECIFIC_RESOURCE_LABEL, id: note.specificResourceId });
