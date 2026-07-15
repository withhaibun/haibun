/**
 * ResourcesStepper — generic graph-resource steps.
 *
 * Owns Comment domain registration and the generic `comment on … with …` and
 * `get related for …` steps.
 */
import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles } from "../lib/astepper.js";
import { type TIndividualResult } from "../lib/execution.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { requirePrincipal } from "../lib/principal.js";
import {
	BODY_LABEL,
	COMMENT_LABEL,
	DOMAIN_PERSISTED_TYPE,
	LinkRelations,
	TEXT_QUOTE_SELECTOR_LABEL,
	bodyDomainDefinition,
	bodyByMediaType,
	commentDomainDefinition,
	principalDomainDefinition,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
} from "../lib/resources.js";
import { seqPathDomainDefinition } from "../lib/seq-path.js";

/** The minimal store surface resolveLinkQuote reads — a quad query and an individual fetch. */
type TAnnotationStore = {
	query: (pattern: { subject?: string; predicate?: string; object?: unknown }) => Promise<Array<{ object: unknown }>>;
	getIndividual: (label: string, id: string) => Promise<Record<string, unknown> | null>;
};

const CommentCreatedSchema = z.object({ commentId: z.string(), contextRoot: z.string() });
const RelatedItemsSchema = z.object({ items: z.array(z.unknown()), contextRoot: z.string() });
const QuoteSchema = z.object({ exact: z.string(), prefix: z.string().optional(), suffix: z.string().optional() });
const AnnotationListSchema = z.object({
	annotations: z.array(
		z.object({
			commentId: z.string(),
			author: z.string().optional(),
			generatedAtTime: z.string().optional(),
			body: z.string().optional(),
			exact: z.string(),
			prefix: z.string().optional(),
			suffix: z.string().optional(),
			specificResourceId: z.string(),
			// A linking annotation's cross-reference: the quote locating the section this note points at, so a reader can jump to it.
			linksTo: QuoteSchema.optional(),
		}),
	),
	total: z.number(),
});

const cycles = (): IStepperCycles => ({
	getConcerns: () => ({
		domains: [
			bodyDomainDefinition,
			commentDomainDefinition,
			principalDomainDefinition,
			seqPathDomainDefinition,
			specificResourceDomainDefinition,
			textQuoteSelectorDomainDefinition,
		],
	}),
});

class ResourcesStepper extends AStepper implements IHasCycles {
	description = "Graph-resource steps: comment on vertices, get related, and (future) annotations and links";

	cycles = cycles();

	steps = {
		comment: {
			gwta: `comment on {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} with {text: string}`,
			productsSchema: CommentCreatedSchema,
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const author = requirePrincipal(this.getWorld());
				const store = this.getWorld().shared.getStore();
				const commentId = crypto.randomUUID();
				const now = new Date().toISOString();
				await store.upsertIndividual(COMMENT_LABEL, {
					id: commentId,
					author,
					generatedAtTime: now,
					// Title the node by the note text (truncated), not its id; the body is partitioned into a Body sub-resource.
					name: text.replace(/\s+/g, " ").trim().slice(0, 60),
				});
				const bodyId = `body-${commentId}-text-markdown`;
				await store.upsertIndividual(BODY_LABEL, { id: bodyId, content: text, mediaType: "text/markdown", generatedAtTime: now });
				await store.add({ subject: commentId, predicate: LinkRelations.HAS_BODY.rel, object: bodyId, namedGraph: COMMENT_LABEL });
				const targetContext = await store.query({ subject: id, predicate: LinkRelations.CONTEXT.rel });
				const contextRoot = targetContext.length > 0 ? String(targetContext[0].object) : id;
				await store.add({
					subject: commentId,
					predicate: LinkRelations.IN_REPLY_TO.rel,
					object: id,
					namedGraph: label,
				});
				await store.add({
					subject: commentId,
					predicate: LinkRelations.CONTEXT.rel,
					object: contextRoot,
					namedGraph: COMMENT_LABEL,
				});
				if (targetContext.length === 0) {
					await store.add({ subject: id, predicate: LinkRelations.CONTEXT.rel, object: id, namedGraph: label });
				}
				return actionOKWithProducts({ commentId, contextRoot });
			},
		},
		annotations: {
			gwta: `get annotations for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: AnnotationListSchema,
			action: async ({ id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// Walk the W3C Web Annotation chain backwards from the annotated individual:
				// SpecificResource —hasSource→ id, its TextQuoteSelector, and each Comment —hasTarget→ SpecificResource.
				const sourceQuads = await store.query({ predicate: LinkRelations.HAS_SOURCE.rel, object: id });
				const annotations: Array<Record<string, unknown>> = [];
				for (const sq of sourceQuads) {
					const specificResourceId = String(sq.subject);
					const selectorQuads = await store.query({ subject: specificResourceId, predicate: LinkRelations.HAS_SELECTOR.rel });
					if (selectorQuads.length === 0) continue; // a target without a selector anchors nothing
					const selector = (await store.getIndividual(TEXT_QUOTE_SELECTOR_LABEL, String(selectorQuads[0].object))) as Record<string, unknown> | null;
					if (!selector) continue;
					const targetQuads = await store.query({ predicate: LinkRelations.TARGET.rel, object: specificResourceId });
					for (const tq of targetQuads) {
						const commentId = String(tq.subject);
						const comment = (await store.getIndividual(COMMENT_LABEL, commentId)) as Record<string, unknown> | null;
						if (!comment) continue;
						const linksTo = await this.resolveLinkQuote(store, commentId);
						const noteText = await bodyByMediaType(store, comment, "text/markdown");
						annotations.push({
							commentId,
							...(comment.author !== undefined ? { author: String(comment.author) } : {}),
							...(comment.generatedAtTime !== undefined ? { generatedAtTime: String(comment.generatedAtTime) } : {}),
							...(noteText !== undefined ? { body: noteText } : {}),
							exact: String(selector.exact),
							...(selector.prefix !== undefined ? { prefix: String(selector.prefix) } : {}),
							...(selector.suffix !== undefined ? { suffix: String(selector.suffix) } : {}),
							specificResourceId,
							...(linksTo ? { linksTo } : {}),
						});
					}
				}
				return actionOKWithProducts({ annotations, total: annotations.length });
			},
		},
		getRelated: {
			gwta: `get related for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: RelatedItemsSchema,
			action: async ({ label, id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				const contextQuads = await store.query({ subject: id, predicate: LinkRelations.CONTEXT.rel });
				const contextRoot = contextQuads.length > 0 ? String(contextQuads[0].object) : id;
				const contextMembers = await store.query({ predicate: LinkRelations.CONTEXT.rel, object: contextRoot });
				const idLabelMap = new Map<string, string>();
				for (const q of contextMembers) idLabelMap.set(String(q.subject), q.namedGraph);
				if (!idLabelMap.has(contextRoot)) idLabelMap.set(contextRoot, label);
				const items: TIndividualResult[] = [];
				for (const [vid, vlabel] of idLabelMap) {
					const individual = (await store.getIndividual(vlabel, vid)) ?? (await store.getIndividual(COMMENT_LABEL, vid)) ?? (await store.getIndividual(label, vid));
					if (individual) {
						const outgoing = await store.query({ subject: vid });
						const edges = outgoing.filter((q) => q.predicate !== LinkRelations.CONTEXT.rel).map((q) => ({ type: q.predicate, targetId: String(q.object) }));
						items.push({ ...(individual as Record<string, unknown>), _edges: edges });
					}
				}
				items.sort((a, b) => {
					const dateA = String(a.generatedAtTime ?? a.dateSent ?? a.published ?? "");
					const dateB = String(b.generatedAtTime ?? b.dateSent ?? b.published ?? "");
					return dateA.localeCompare(dateB);
				});
				return actionOKWithProducts({ items, contextRoot });
			},
		},
	} satisfies TStepperSteps;

	/** The quote of the section a linking annotation points at: Comment —linksTo→ SpecificResource → its TextQuoteSelector.
	 *  Undefined for an ordinary (non-linking) annotation. Lets a reader jump from the note to the section it references. */
	private async resolveLinkQuote(store: TAnnotationStore, commentId: string): Promise<{ exact: string; prefix?: string; suffix?: string } | undefined> {
		const linkQuads = await store.query({ subject: commentId, predicate: LinkRelations.LINKS_TO.rel });
		if (linkQuads.length === 0) return undefined;
		const linkSrId = String(linkQuads[0].object);
		const selQuads = await store.query({ subject: linkSrId, predicate: LinkRelations.HAS_SELECTOR.rel });
		if (selQuads.length === 0) return undefined;
		const selector = (await store.getIndividual(TEXT_QUOTE_SELECTOR_LABEL, String(selQuads[0].object))) as Record<string, unknown> | null;
		if (!selector) return undefined;
		return {
			exact: String(selector.exact),
			...(selector.prefix !== undefined ? { prefix: String(selector.prefix) } : {}),
			...(selector.suffix !== undefined ? { suffix: String(selector.suffix) } : {}),
		};
	}

	constructor() {
		super();
	}
}

export default ResourcesStepper;
