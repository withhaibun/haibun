/**
 * The notes anchored in a record (`page/derivations/annotations.ts`): what the site's annotations step returns, or, for a
 * page that carries a record of actuality, the reverse walk over the quads the page holds.
 */
import {
	AnnotationListSchema,
	BODY_LABEL,
	COMMENT_LABEL,
	LinkRelations,
	SPECIFIC_RESOURCE_LABEL,
	TEXT_QUOTE_SELECTOR_LABEL,
	type TAnnotationView,
	type TQuoteAnchor,
} from "@haibun/core/lib/domains/resources.js";
import type { TQuad, TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { bySubject, edgeOf, literalOf } from "../derivations/annotations.js";
import type { TCallOutcome } from "./call-step.js";

/** What a read of the notes reads: a call of a step of actuality, and the quads the page holds that match a pattern. */
export type TAnnotationScope = {
	call: <T>(step: string, params: Record<string, unknown>, why: string) => Promise<TCallOutcome<T>>;
	quads: (pattern: TQuadPattern) => Promise<TQuad[]>;
};

/** The step that returns the notes anchored in a record. */
const ANNOTATIONS_STEP = "annotations";

/** Returns the notes anchored in the record `label` and `id` name, as the site's annotations step returns them, or the refusal. */
export async function annotationsOnSite(scope: TAnnotationScope, label: string, id: string): Promise<TCallOutcome<TAnnotationView[]>> {
	const read = await scope.call<unknown>(ANNOTATIONS_STEP, { label, id }, `the notes anchored in ${label}:${id}`);
	return read.ok ? { ok: true, value: AnnotationListSchema.parse(read.value).annotations } : read;
}

/** The quads of each subject of one type the page holds, by the subject. */
type TBySubject = Map<string, TQuad[]>;

/** Returns the notes anchored in the record `id` names, from the quads the page holds, with one read of each type a note
 *  holds: each SpecificResource whose source is the record, its selector, and each Comment that targets it, with its body. */
export async function annotationsHeld(scope: TAnnotationScope, id: string): Promise<TAnnotationView[]> {
	const held = async (namedGraph: string): Promise<TBySubject> => bySubject(await scope.quads({ namedGraph }));
	const [resources, selectors, comments, bodies] = await Promise.all([held(SPECIFIC_RESOURCE_LABEL), held(TEXT_QUOTE_SELECTOR_LABEL), held(COMMENT_LABEL), held(BODY_LABEL)]);
	const quoteOf = (resourceId: string): TQuoteAnchor | undefined => {
		const resource = resources.get(resourceId);
		const selector = resource === undefined ? undefined : selectors.get(String(edgeOf(resource, LinkRelations.HAS_SELECTOR.rel)));
		const exact = selector === undefined ? undefined : literalOf(selector, LinkRelations.EXACT.rel);
		if (selector === undefined || exact === undefined) return undefined;
		const prefix = literalOf(selector, LinkRelations.PREFIX.rel);
		const suffix = literalOf(selector, LinkRelations.SUFFIX.rel);
		return { exact, ...(prefix !== undefined ? { prefix } : {}), ...(suffix !== undefined ? { suffix } : {}) };
	};
	const out: TAnnotationView[] = [];
	for (const [resourceId, quads] of resources) {
		const quote = edgeOf(quads, LinkRelations.HAS_SOURCE.rel) === id ? quoteOf(resourceId) : undefined;
		if (quote === undefined) continue;
		for (const [commentId, commentQuads] of comments) {
			if (edgeOf(commentQuads, LinkRelations.TARGET.rel) !== resourceId) continue;
			const links = commentQuads
				.filter((q) => q.predicate === LinkRelations.LINKS_TO.rel && q.objectType !== undefined)
				.flatMap((q) => [quoteOf(String(q.object))].filter((linked) => linked !== undefined));
			const author = literalOf(commentQuads, LinkRelations.ATTRIBUTED_TO.rel);
			const generatedAtTime = literalOf(commentQuads, LinkRelations.GENERATED_AT_TIME.rel);
			const body = bodyOf(bodies, commentQuads);
			out.push({
				commentId,
				specificResourceId: resourceId,
				...quote,
				...(author !== undefined ? { author } : {}),
				...(generatedAtTime !== undefined ? { generatedAtTime } : {}),
				...(body !== undefined ? { body } : {}),
				...(links.length > 0 ? { links } : {}),
			});
		}
	}
	return out;
}

/** Returns the markdown body of a Comment: the content of the Body its `hasBody` edge reaches. */
function bodyOf(bodies: TBySubject, commentQuads: TQuad[]): string | undefined {
	const body = bodies.get(String(edgeOf(commentQuads, LinkRelations.HAS_BODY.rel)));
	return body === undefined ? undefined : literalOf(body, LinkRelations.CONTENT.rel);
}
