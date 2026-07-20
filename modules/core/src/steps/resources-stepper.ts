/**
 * ResourcesStepper — generic graph-resource steps.
 *
 * Owns the discourse acts over any graph resource: `comment on …`, the `annotate …` family (quoting a passage, linking
 * one passage to another, or anchoring with surrounding context), the `get annotations for …` read, and `get related for …`.
 * The write logic lives in resources.ts (createComment / writeAnnotation) so it is reusable and store-agnostic.
 */
import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles } from "../lib/astepper.js";
import { type TIndividualResult } from "../lib/execution.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { requirePrincipal } from "../lib/principal.js";
import {
	COMMENT_LABEL,
	DOMAIN_PERSISTED_TYPE,
	LinkRelations,
	isReplyEdge,
	SPECIFIC_RESOURCE_LABEL,
	TEXT_QUOTE_SELECTOR_LABEL,
	ANNOTATION_PLACEMENT_DOMAIN,
	type TAnnotationPlacement,
	bodyDomainDefinition,
	bodyByMediaType,
	commentDomainDefinition,
	principalDomainDefinition,
	specificResourceDomainDefinition,
	textQuoteSelectorDomainDefinition,
	annotationPlacementDomainDefinition,
	createComment,
	writeAnnotation,
	writeEdge,
	conversationRoot,
	assertCommentGrounded,
} from "../lib/resources.js";
import { seqPathDomainDefinition } from "../lib/seq-path.js";

const CommentCreatedSchema = z.object({ commentId: z.string(), contextRoot: z.string() });
const AnnotationCreatedSchema = z.object({ commentId: z.string(), specificResourceId: z.string(), linkedSpecificResourceId: z.string().optional(), contextRoot: z.string() });
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
			annotationPlacementDomainDefinition,
		],
	}),
});

class ResourcesStepper extends AStepper implements IHasCycles {
	description = "Graph-resource steps: comment on vertices, annotate passages, get related, and get annotations";

	cycles = cycles();

	/** The shared tail of every `annotate` variant: write the annotation, resolve its conversation root, return both.
	 *  Each variant only shapes the passage/link arg; the principal, store, and threading are identical. */
	private async runAnnotate(a: Parameters<typeof writeAnnotation>[2]) {
		const store = this.getWorld().shared.getStore();
		const written = await writeAnnotation(store, requirePrincipal(this.getWorld()), a);
		const contextRoot = await conversationRoot(store, a.id);
		return actionOKWithProducts({ ...written, contextRoot });
	}

	steps = {
		comment: {
			gwta: `comment on {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} with {text: string}`,
			productsSchema: CommentCreatedSchema,
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const author = requirePrincipal(this.getWorld());
				const store = this.getWorld().shared.getStore();
				const commentId = await createComment(store, author, text, new Date().toISOString());
				// The comment narrates what it is about (narrate is a sub-property of inReplyTo, so it both grounds and threads it).
				await writeEdge(store, COMMENT_LABEL, commentId, LinkRelations.NARRATE.rel, label, id);
				await assertCommentGrounded(store, commentId);
				const contextRoot = await conversationRoot(store, id);
				return actionOKWithProducts({ commentId, contextRoot });
			},
		},
		annotate: {
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} quoting {exact: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
			// The prose gwta binds label/id/exact/text; UI authoring calls this same action over RPC with the extra
			// prefix/suffix (the selection's context, for a reliable anchor) and an optional link passage.
			action: async (p: { label: string; id: string; exact: string; text: string; prefix?: string; suffix?: string; link?: { exact: string; prefix?: string; suffix?: string } }) => this.runAnnotate(p),
		},
		annotateLinking: {
			// `linking` sits right after the id (before `quoting`) so the plain `annotate … quoting …` gwta cannot also
			// match this prose — the two steps stay unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} linking {exact: string} to {linkExact: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
			action: async ({ label, id, exact, linkExact, text }: { label: string; id: string; exact: string; linkExact: string; text: string }) =>
				this.runAnnotate({ label, id, exact, text, link: { exact: linkExact } }),
		},
		annotateAnchored: {
			// The quote's surrounding text as one TextQuoteSelector context, its side given by {placement}: "preceded by"
			// makes the context the prefix, "followed by" makes it the suffix — so a short or repeated quote resolves to the
			// intended occurrence. `anchoring` sits right after the id (a distinct keyword from `quoting`/`linking`) to keep
			// the three annotate prose forms unambiguous.
			gwta: `annotate {label: ${DOMAIN_PERSISTED_TYPE}} {id: string} anchoring {exact: string} {placement: ${ANNOTATION_PLACEMENT_DOMAIN}} {context: string} with {text: string}`,
			productsSchema: AnnotationCreatedSchema,
			action: async ({ label, id, exact, placement, context, text }: { label: string; id: string; exact: string; placement: TAnnotationPlacement; context: string; text: string }) =>
				this.runAnnotate({ label, id, exact, ...(placement === "preceded by" ? { prefix: context } : { suffix: context }), text }),
		},
		annotations: {
			gwta: `get annotations for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: AnnotationListSchema,
			action: async ({ id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// Reverse-walk the W3C Web Annotation chain from the annotated individual with LABEL-SCOPED bulk reads, then
				// join them in memory. An unscoped or per-note quad query on a property-graph store reloads every type and
				// every body — including this document's own — so the naive walk costs note-count × document-size; this is a
				// fixed handful of scoped reads instead. SpecificResource —hasSource→ id, —hasSelector→ TextQuoteSelector;
				// Comment —hasTarget→ SpecificResource, optionally —linksTo→ another SpecificResource.
				const srIds = new Set((await store.query({ predicate: LinkRelations.HAS_SOURCE.rel, object: id, namedGraph: SPECIFIC_RESOURCE_LABEL })).map((q) => String(q.subject)));
				if (srIds.size === 0) return actionOKWithProducts({ annotations: [], total: 0 });
				const selectorOfSr = new Map<string, string>();
				for (const q of await store.query({ predicate: LinkRelations.HAS_SELECTOR.rel, namedGraph: SPECIFIC_RESOURCE_LABEL })) selectorOfSr.set(String(q.subject), String(q.object));
				const linkSrOfComment = new Map<string, string>();
				for (const q of await store.query({ predicate: LinkRelations.LINKS_TO.rel, namedGraph: COMMENT_LABEL })) linkSrOfComment.set(String(q.subject), String(q.object));
				const selectorById = new Map<string, Record<string, unknown>>();
				for (const s of (await store.queryIndividuals(TEXT_QUOTE_SELECTOR_LABEL)) as Array<Record<string, unknown>>) selectorById.set(String(s.id), s);
				const quoteOf = (srId: string | undefined): { exact: string; prefix?: string; suffix?: string } | undefined => {
					const sel = srId ? selectorById.get(selectorOfSr.get(srId) ?? "") : undefined;
					if (!sel) return undefined;
					return { exact: String(sel.exact), ...(sel.prefix !== undefined ? { prefix: String(sel.prefix) } : {}), ...(sel.suffix !== undefined ? { suffix: String(sel.suffix) } : {}) };
				};
				const annotations: Array<Record<string, unknown>> = [];
				for (const tq of await store.query({ predicate: LinkRelations.TARGET.rel, namedGraph: COMMENT_LABEL })) {
					const specificResourceId = String(tq.object);
					if (!srIds.has(specificResourceId)) continue;
					const quote = quoteOf(specificResourceId);
					if (!quote) continue; // a target without a selector anchors nothing
					const commentId = String(tq.subject);
					const comment = (await store.getIndividual(COMMENT_LABEL, commentId)) as Record<string, unknown> | null;
					if (!comment) continue;
					const noteText = await bodyByMediaType(store, comment, "text/markdown");
					const linksTo = quoteOf(linkSrOfComment.get(commentId));
					annotations.push({
						commentId,
						...(comment.author !== undefined ? { author: String(comment.author) } : {}),
						...(comment.generatedAtTime !== undefined ? { generatedAtTime: String(comment.generatedAtTime) } : {}),
						...(noteText !== undefined ? { body: noteText } : {}),
						...quote,
						specificResourceId,
						...(linksTo ? { linksTo } : {}),
					});
				}
				return actionOKWithProducts({ annotations, total: annotations.length });
			},
		},
		getRelated: {
			gwta: `get related for {label: ${DOMAIN_PERSISTED_TYPE}} {id: string}`,
			productsSchema: RelatedItemsSchema,
			action: async ({ label, id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				// The thread is the conversation root plus every comment that replies (transitively) to a member.
				const contextRoot = await conversationRoot(store, id);
				const memberLabel = new Map<string, string>([[contextRoot, label]]);
				const frontier = [contextRoot];
				for (let guard = 0; frontier.length > 0 && guard < 10000; guard++) {
					const cur = frontier.shift() as string;
					const incoming = (await store.query({ object: cur })).filter((q) => isReplyEdge(q.predicate));
					for (const q of incoming) {
						if (!memberLabel.has(q.subject)) {
							memberLabel.set(q.subject, q.namedGraph);
							frontier.push(q.subject);
						}
					}
				}
				const items: TIndividualResult[] = [];
				for (const [vid, vlabel] of memberLabel) {
					const individual = (await store.getIndividual(vlabel, vid)) ?? (await store.getIndividual(COMMENT_LABEL, vid)) ?? (await store.getIndividual(label, vid));
					if (individual) {
						const outgoing = await store.query({ subject: vid });
						const edges = outgoing.filter((q) => !isReplyEdge(q.predicate)).map((q) => ({ type: q.predicate, targetId: String(q.object) }));
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

	constructor() {
		super();
	}
}

export default ResourcesStepper;
