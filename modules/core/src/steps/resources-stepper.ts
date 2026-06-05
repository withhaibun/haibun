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
import { BODY_LABEL, COMMENT_LABEL, DOMAIN_PERSISTED_TYPE, LinkRelations, bodyDomainDefinition, commentDomainDefinition, principalDomainDefinition } from "../lib/resources.js";
import { seqPathDomainDefinition } from "../lib/seq-path.js";

const CommentCreatedSchema = z.object({ commentId: z.string(), contextRoot: z.string() });
const RelatedItemsSchema = z.object({ items: z.array(z.unknown()), contextRoot: z.string() });

const cycles = (): IStepperCycles => ({
	getConcerns: () => ({
		domains: [bodyDomainDefinition, commentDomainDefinition, principalDomainDefinition, seqPathDomainDefinition],
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

	constructor() {
		super();
	}
}

export default ResourcesStepper;
