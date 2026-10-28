/**
 * The notes anchored in a record, as the annotator library reads them, and the reads of the quads that describe a note.
 * A note is a Comment whose `oa:hasTarget` is a SpecificResource that points back at the record (`oa:hasSource`) through a
 * TextQuoteSelector (`oa:hasSelector`).
 */
import { locateQuoteOffsets } from "@haibun/core/lib/domains/quote-anchor.js";
import { MEDIA_TYPE } from "@haibun/core/lib/domains/media-types.js";
import type { TAnnotationView } from "@haibun/core/lib/domains/resources.js";
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

/** Returns the notes as the annotator library reads them, anchored in `containerText`, the rendered body text. A note whose
 *  quote the rendering doesn't hold is left out, since a highlight can't mark it; the note list still shows it. */
export function toW3CAnnotations(annotations: TAnnotationView[], source: string, containerText: string): TW3CTextAnnotation[] {
	const out: TW3CTextAnnotation[] = [];
	for (const a of annotations) {
		const pos = locateQuoteOffsets(containerText, a.exact, a.prefix, a.suffix);
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
