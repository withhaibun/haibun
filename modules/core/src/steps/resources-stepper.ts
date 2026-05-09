/**
 * ResourcesStepper — generic graph-resource steps.
 *
 * Owns Comment domain registration and the generic `comment on … with …` and
 * `get related for …` steps. Future generic resource steps (annotations,
 * links, create-any-resource, traverse-any-edge-by-rel) belong here as they
 * arrive — one coarse-grained stepper keeps config.json lean.
 *
 * Split out of VariablesStepper so that feature-variable scope handling and
 * graph-resource operations stop sharing a stepper. VariablesStepper is about
 * set/get/compare of feature variables; ResourcesStepper is about vertices
 * and their relationships.
 */
import { z } from "zod";
import { AStepper, IHasCycles, TStepperSteps, IStepperCycles } from "../lib/astepper.js";
import { type TVertexResult } from "../lib/execution.js";
import { actionOKWithProducts } from "../lib/util/index.js";
import { BODY_LABEL, COMMENT_LABEL, DOMAIN_VERTEX_LABEL, LinkRelations, bodyDomainDefinition, commentDomainDefinition } from "../lib/resources.js";
import { seqPathDomainDefinition } from "../lib/seq-path.js";

const cycles = (): IStepperCycles => ({
	getConcerns: () => ({
		domains: [bodyDomainDefinition, commentDomainDefinition, seqPathDomainDefinition],
	}),
});

class ResourcesStepper extends AStepper implements IHasCycles {
	description = "Graph-resource steps: comment on vertices, get related, and (future) annotations and links";

	cycles = cycles();

	steps = {
		comment: {
			gwta: `comment on {label: ${DOMAIN_VERTEX_LABEL}} {id: string} with {text: string}`,
			outputSchema: z.object({ commentId: z.string() }),
			action: async ({ label, id, text }: { label: string; id: string; text: string }) => {
				const store = this.getWorld().shared.getStore();
				const commentId = crypto.randomUUID();
				const now = new Date().toISOString();
				await store.upsertVertex(COMMENT_LABEL, {
					id: commentId,
					timestamp: now,
				});
				const bodyId = `body-${commentId}-text-markdown`;
				await store.upsertVertex(BODY_LABEL, { id: bodyId, content: text, mediaType: "text/markdown", createdAt: now });
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
			gwta: `get related for {label: ${DOMAIN_VERTEX_LABEL}} {id: string}`,
			outputSchema: z.object({ items: z.array(z.unknown()), contextRoot: z.string() }),
			action: async ({ label, id }: { label: string; id: string }) => {
				const store = this.getWorld().shared.getStore();
				const contextQuads = await store.query({ subject: id, predicate: LinkRelations.CONTEXT.rel });
				const contextRoot = contextQuads.length > 0 ? String(contextQuads[0].object) : id;
				const contextMembers = await store.query({ predicate: LinkRelations.CONTEXT.rel, object: contextRoot });
				const idLabelMap = new Map<string, string>();
				for (const q of contextMembers) idLabelMap.set(String(q.subject), q.namedGraph);
				if (!idLabelMap.has(contextRoot)) idLabelMap.set(contextRoot, label);
				const items: TVertexResult[] = [];
				for (const [vid, vlabel] of idLabelMap) {
					const vertex = (await store.getVertex(vlabel, vid)) ?? (await store.getVertex(COMMENT_LABEL, vid)) ?? (await store.getVertex(label, vid));
					if (vertex) {
						const outgoing = await store.query({ subject: vid });
						const edges = outgoing.filter((q) => q.predicate !== LinkRelations.CONTEXT.rel).map((q) => ({ type: q.predicate, targetId: String(q.object) }));
						const replyTo = edges.find((e) => e.type === LinkRelations.IN_REPLY_TO.rel);
						items.push({ ...(vertex as Record<string, unknown>), _id: vid, _inReplyTo: replyTo?.targetId, _edges: edges });
					}
				}
				items.sort((a, b) => {
					const dateA = String(a.timestamp ?? a.dateSent ?? a.published ?? "");
					const dateB = String(b.timestamp ?? b.dateSent ?? b.published ?? "");
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
