/**
 * Auto-generate CRUD steps from domain declarations.
 * Any domain with meta.vertexLabel gets create/get/delete/list steps.
 * Steps operate against IQuadStore — the same store used for all shared state.
 */

import { z } from "zod";
import type { TStepperStep } from "./astepper.js";
import type { IQuadStore } from "./quad-types.js";
import { actionOK, actionNotOK, actionOKWithProducts } from "./util/index.js";

export const VERTEX_STORE_KEY = "vertexStore";

/**
 * Generate CRUD step definitions for a vertex type. The get returns the typed vertex
 * itself (matching the domain schema); the list step declares its productsDomain as
 * `<domainKey>-list` so its output is a registered list type.
 */
export function vertexCrudSteps(label: string, domainKey: string, listDomainKey: string, getStore: () => IQuadStore): Record<string, TStepperStep> {
	const lc = label.toLowerCase();
	return {
		[`create${label}`]: {
			gwta: `create ${lc} {data: ${domainKey}}`,
			action: async ({ data }: { data: unknown }) => {
				await getStore().upsertVertex(label, data);
				return actionOK();
			},
		},
		[`get${label}`]: {
			gwta: `get ${lc} {id: string}`,
			productsDomain: domainKey,
			action: async ({ id }: { id: string }) => {
				const vertex = await getStore().getVertex(label, id);
				if (!vertex) return actionNotOK(`${label} not found: ${id}`);
				return actionOKWithProducts(vertex as Record<string, unknown>);
			},
		},
		[`delete${label}`]: {
			gwta: `delete ${lc} {id: string}`,
			action: async ({ id }: { id: string }) => {
				await getStore().deleteVertex(label, id);
				return actionOK();
			},
		},
		[`list${label}s`]: {
			gwta: `list ${lc}s`,
			productsDomain: listDomainKey,
			action: async (args: Record<string, unknown>) => {
				const filters: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(args)) {
					if (v !== undefined && k !== "limit" && k !== "offset") filters[k] = v;
				}
				const limit = (args.limit as number) ?? 50;
				const offset = (args.offset as number) ?? 0;
				const vertices = await getStore().queryVertices(label, Object.keys(filters).length > 0 ? filters : undefined, {
					limit,
					offset,
				});
				return actionOKWithProducts({ vertices, total: vertices.length });
			},
		},
	};
}

/** Domain-key suffix that names the list result for a vertex domain. */
export const VERTEX_LIST_DOMAIN_SUFFIX = "-list";

/** Schema for the vertex-list output: an array of vertices plus a total count. Strict so a producer can't sneak extra fields past consumers. */
export const VertexListSchema = z.object({ vertices: z.array(z.unknown()), total: z.number() }).strict();

/**
 * Generate CRUD steps for ALL vertex domains.
 * Call after getConcerns has populated world.domains. The list step's productsDomain
 * is `<domainKey>-list` — register that domain alongside the vertex domain when
 * declaring concerns.
 */
export function generateVertexCrudFromDomains(
	domains: Record<string, { schema: z.ZodType; topology?: Record<string, unknown> }>,
	getStore: () => IQuadStore,
): Record<string, TStepperStep> {
	const steps: Record<string, TStepperStep> = {};
	for (const [key, domain] of Object.entries(domains)) {
		const topology = domain.topology as { vertexLabel?: string } | undefined;
		if (!topology?.vertexLabel) continue;
		Object.assign(steps, vertexCrudSteps(topology.vertexLabel, key, `${key}${VERTEX_LIST_DOMAIN_SUFFIX}`, getStore));
	}
	return steps;
}
