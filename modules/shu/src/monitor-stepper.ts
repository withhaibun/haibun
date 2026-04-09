/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { LinkRelations, type IStepperCycles } from "@haibun/core/lib/defs.js";
import { objectCoercer } from "@haibun/core/lib/domain-types.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { parseSeqPath } from "./quad-detail-pane.js";

import { DOMAIN_GRAPH_QUERY, GraphQuerySchema } from "@haibun/core/lib/quad-types.js";

const MAX_EVENTS = 10000;

export default class MonitorStepper extends AStepper implements IHasCycles {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: [DOMAIN_GRAPH_QUERY],
					schema: GraphQuerySchema,
					coerce: objectCoercer(GraphQuerySchema),
					description: "Graph query parameters",
				},
			],
		}),
		onEvent: (event: THaibunEvent) => {
			this.events.push(event);
			if (this.events.length > MAX_EVENTS) this.events.shift();
			this.transport?.send({ type: "event", event });
		},
	};

	steps = {
		showMonitor: {
			gwta: "show monitor",
			action: () => actionOKWithProducts({ view: "monitor" }),
		},
		showSequenceDiagram: {
			gwta: "show sequence diagram",
			action: () => actionOKWithProducts({ view: "sequence" }),
		},
		getEvents: {
			gwta: "get monitor events",
			outputSchema: z.object({ events: z.array(z.unknown()) }),
			action: ({ level, kind, since }: { level?: string; kind?: string; since?: number }) => {
				let filtered: THaibunEvent[] = this.events;
				if (level) filtered = filtered.filter((e) => e.level === level);
				if (kind) filtered = filtered.filter((e) => e.kind === kind);
				if (since) filtered = filtered.filter((e) => e.timestamp >= since);
				return actionOKWithProducts({
					events: filtered.map(({ kind, level, timestamp, id, ...rest }) => ({
						kind,
						level,
						timestamp,
						id,
						in: (rest as Record<string, unknown>).in,
						message: (rest as Record<string, unknown>).message,
						type: (rest as Record<string, unknown>).type,
						stage: (rest as Record<string, unknown>).stage,
						status: (rest as Record<string, unknown>).status,
						actionName: (rest as Record<string, unknown>).actionName,
						artifactType: (rest as Record<string, unknown>).artifactType,
						seqPath: parseSeqPath(id),
					})),
				});
			},
		},
		getDispatchTraces: {
			gwta: "get dispatch traces",
			outputSchema: z.object({ traces: z.array(z.unknown()) }),
			action: () => {
				const traces = this.events
					.filter((e) => e.kind === "artifact" && (e as Record<string, unknown>).artifactType === "dispatch-trace")
					.map((e) => {
						const t = (e as Record<string, unknown>).trace;
						return typeof t === "object" && t ? { ...(t as Record<string, unknown>), timestamp: e.timestamp } : t;
					});
				return actionOKWithProducts({ traces });
			},
		},
		showGraphView: {
			gwta: "show graph view",
			action: () => actionOKWithProducts({ view: "graph" }),
		},
		graphQuery: {
			gwta: `graph query {query: ${DOMAIN_GRAPH_QUERY}}`,
			precludes: ["GraphStepper.graphQuery"],
			outputSchema: z.object({ vertices: z.array(z.unknown()), total: z.number(), cypher: z.string() }),
			action: async ({ query }: { query: z.infer<typeof GraphQuerySchema> }) => {
				const store = this.getWorld().shared.getStore();
				const label = query.label;
				if (!label) return actionNotOK("graphQuery requires a label");
				const limit = query.limit || 50;
				const offset = query.offset || 0;
				const filters = query.filters?.length ? Object.fromEntries(query.filters.map((f) => [f.predicate, f.value])) : undefined;
				const vertices = await store.queryVertices(label, filters, { limit, offset });
				const allQuads = await store.query({ namedGraph: label });
				const total = new Set(allQuads.map((q) => q.subject)).size;
				return actionOKWithProducts({ vertices, total, cypher: `QuadStore query: ${label}` });
			},
		},
		getQuads: {
			gwta: "get quads",
			outputSchema: z.object({ quads: z.array(z.unknown()) }),
			action: async () => {
				const store = this.getWorld().shared.getStore();
				const quads = await store.all();
				return actionOKWithProducts({
					quads: quads.map(({ subject, predicate, object, namedGraph, timestamp, properties }) => ({
						subject,
						predicate,
						object,
						namedGraph,
						timestamp,
						properties,
					})),
				});
			},
		},
	} satisfies TStepperSteps;
}
