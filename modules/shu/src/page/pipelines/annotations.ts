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

/** Returns the notes anchored in the record `id` names, from the quads the page holds: each SpecificResource whose source
 *  is the record, its selector, and each Comment that targets it, with its body. */
export async function annotationsHeld(scope: TAnnotationScope, id: string): Promise<TAnnotationView[]> {
	const resources = bySubject(await scope.quads({ namedGraph: SPECIFIC_RESOURCE_LABEL }));
	const comments = bySubject(await scope.quads({ namedGraph: COMMENT_LABEL }));
	const out: TAnnotationView[] = [];
	for (const [resourceId, quads] of resources) {
		if (edgeOf(quads, LinkRelations.HAS_SOURCE.rel) !== id) continue;
		const quote = await quoteOf(scope, quads);
		if (quote === undefined) continue;
		for (const [commentId, commentQuads] of comments) {
			if (edgeOf(commentQuads, LinkRelations.TARGET.rel) !== resourceId) continue;
			const links = await linkedQuotesOf(scope, commentQuads);
			const author = literalOf(commentQuads, LinkRelations.ATTRIBUTED_TO.rel);
			const generatedAtTime = literalOf(commentQuads, LinkRelations.GENERATED_AT_TIME.rel);
			const body = await bodyOf(scope, commentQuads);
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

/** Returns the quote of a SpecificResource's TextQuoteSelector, or undefined where it doesn't hold a selector with a quote. */
async function quoteOf(scope: TAnnotationScope, resourceQuads: TQuad[]): Promise<TQuoteAnchor | undefined> {
	const selectorId = edgeOf(resourceQuads, LinkRelations.HAS_SELECTOR.rel);
	if (selectorId === undefined) return undefined;
	const selector = await scope.quads({ subject: selectorId, namedGraph: TEXT_QUOTE_SELECTOR_LABEL });
	const exact = literalOf(selector, LinkRelations.EXACT.rel);
	if (exact === undefined) return undefined;
	const prefix = literalOf(selector, LinkRelations.PREFIX.rel);
	const suffix = literalOf(selector, LinkRelations.SUFFIX.rel);
	return { exact, ...(prefix !== undefined ? { prefix } : {}), ...(suffix !== undefined ? { suffix } : {}) };
}

/** Returns the markdown body of a Comment: the content of the Body its `hasBody` edge reaches. */
async function bodyOf(scope: TAnnotationScope, commentQuads: TQuad[]): Promise<string | undefined> {
	const bodyId = edgeOf(commentQuads, LinkRelations.HAS_BODY.rel);
	return bodyId === undefined ? undefined : literalOf(await scope.quads({ subject: bodyId, namedGraph: BODY_LABEL }), LinkRelations.CONTENT.rel);
}

/** Returns the quotes of the sections a linking Comment points at: each `linksTo` edge's SpecificResource, and its selector. */
async function linkedQuotesOf(scope: TAnnotationScope, commentQuads: TQuad[]): Promise<TQuoteAnchor[]> {
	const out: TQuoteAnchor[] = [];
	for (const q of commentQuads.filter((x) => x.predicate === LinkRelations.LINKS_TO.rel && x.objectType !== undefined)) {
		const quote = await quoteOf(scope, await scope.quads({ subject: String(q.object), namedGraph: SPECIFIC_RESOURCE_LABEL }));
		if (quote !== undefined) out.push(quote);
	}
	return out;
}
