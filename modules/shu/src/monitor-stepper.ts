/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/defs.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import type { TEndFeature } from "@haibun/core/lib/defs.js";
import { writeFileSync } from "fs";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { actionNotOK, actionOKWithProducts, stringOrError, findStepperFromOptionOrKind, actualURI } from "@haibun/core/lib/util/index.js";
import { type IStepperCycles } from "@haibun/core/lib/defs.js";
import { objectCoercer } from "@haibun/core/lib/domain-types.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { parseSeqPath } from "./quad-detail-pane.js";
import { loadBundle, buildSpaHtml } from "./shu-stepper.js";
import { RPC_CACHE } from "@haibun/web-server-hono/web-server-stepper.js";

import { DOMAIN_GRAPH_QUERY, GraphQuerySchema } from "@haibun/core/lib/quad-types.js";

const MAX_EVENTS = 10000;

export default class MonitorStepper extends AStepper implements IHasCycles, IHasOptions {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];
	private storage?: AStorage;
	private outputPath?: string;

	options = {
		[StepperKinds.STORAGE]: { desc: "Storage for standalone HTML output", parse: stringOrError },
	};

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		try {
			this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		} catch {
			this.getWorld().eventLogger.info("MonitorStepper: no storage configured, standalone HTML will not be written");
		}
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
		endFeature: async ({ shouldClose = true }: TEndFeature) => {
			if (!shouldClose || !this.storage) return;
			const rpcCache = (this.getWorld().runtime[RPC_CACHE] ?? {}) as Record<string, unknown>;
			// Ensure essential data is always available offline:
			// 1. Events (the test execution log — core of the monitor view)
			if (!rpcCache["MonitorStepper-getEvents"]) {
				rpcCache["MonitorStepper-getEvents"] = (this.steps.getEvents.action({} as { level?: string; kind?: string; since?: number }) as { products: unknown }).products;
			}
			// 2. Parameterless steps with view products (deterministic view toggles)
			for (const [name, step] of Object.entries(this.steps)) {
				const key = `MonitorStepper-${name}`;
				if (rpcCache[key] || step.gwta.includes("{")) continue;
				try {
					const r = (step.action as () => unknown)() as { products?: Record<string, unknown> };
					if (r?.products?.view) rpcCache[key] = r.products;
				} catch {
					/* skip */
				}
			}
			if (!rpcCache["step.list"]) {
				rpcCache["step.list"] = { steps: [], domains: {}, concerns: buildConcernCatalog(this.getWorld().domains) };
			}
			// Reconstruct view hash from events (view products) and cache (last query label)
			const cols: string[] = [];
			let label = "";
			for (const e of this.events) {
				const ev = e as Record<string, unknown>;
				if (ev.kind !== "lifecycle" || ev.stage !== "end") continue;
				const view = (ev.products as Record<string, unknown>)?.view;
				if (typeof view === "string" && !cols.includes(`${view}:`)) cols.push(`${view}:`);
			}
			for (const key of Object.keys(rpcCache)) {
				if (!key.includes("graphQuery:")) continue;
				try {
					const params = JSON.parse(key.slice(key.indexOf(":") + 1));
					if (params?.query?.label) label = params.query.label;
				} catch {
					/* */
				}
			}
			const hashParts = new URLSearchParams();
			if (label) hashParts.set("label", label);
			for (const col of cols) hashParts.append("col", col);
			const viewHash = hashParts.toString() ? `#?${hashParts.toString()}` : "";
			const hydration = JSON.stringify({ events: this.events, rpcCache, viewHash });
			const bundle = loadBundle();
			let html = buildSpaHtml(".", bundle, hydration);
			const secrets = await this.getWorld().shared.getSecrets();
			for (const [, value] of Object.entries(secrets)) {
				if (value) html = html.replaceAll(value, OBSCURED_VALUE);
			}
			const fixedPath = this.outputPath;
			if (fixedPath) {
				writeFileSync(fixedPath, html);
				this.getWorld().eventLogger.info(`shu standalone report: ${actualURI(fixedPath)}`);
			} else {
				const saved = await this.storage.saveArtifact("shu.html", html, EMediaTypes.html);
				this.getWorld().eventLogger.info(`shu standalone report: ${actualURI(saved.absolutePath)}`);
			}
		},
	};

	steps = {
		savesShuTo: {
			gwta: "saves shu to {where: string}",
			action: ({ where }: { where: string }) => {
				this.outputPath = where;
				return actionOKWithProducts({});
			},
		},
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
					quads: quads.map(({ subject, predicate, object, namedGraph, timestamp, properties }) => ({ subject, predicate, object, namedGraph, timestamp, properties })),
				});
			},
		},
	} satisfies TStepperSteps;
}
