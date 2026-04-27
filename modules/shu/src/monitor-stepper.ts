/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "path";
import { z } from "zod";
import { writeFileSync } from "fs";

import { AStepper, type IHasCycles, type IHasOptions, type IHasTunables, type TStepperSteps, StepperKinds } from "@haibun/core/lib/astepper.js";
import { type TWorld, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/execution.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { actionNotOK, actionOKWithProducts, getStepperOption, intOrError, stringOrError, findStepperFromOptionOrKind } from "@haibun/core/lib/util/index.js";
import { actualURI } from "@haibun/core/lib/util/node/actualURI.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { WEBSERVER, type IWebServer } from "@haibun/web-server-hono/defs.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { parseSeqPath } from "./quad-detail-pane.js";
import { loadBundle, buildSpaHtml } from "./shu-stepper.js";
import { RPC_CACHE } from "@haibun/web-server-hono/web-server-stepper.js";

import { DOMAIN_GRAPH_QUERY, GraphQuerySchema } from "@haibun/core/lib/quad-types.js";

const MAX_EVENTS_DEFAULT = 10000;

export default class MonitorStepper extends AStepper implements IHasCycles, IHasOptions, IHasTunables {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];
	private observationQuads: TQuad[] = [];
	private storage!: AStorage;
	private outputPath?: string;
	private maxEvents: number = MAX_EVENTS_DEFAULT;
	cyclesWhen = { startFeature: CycleWhen.LAST };

	options = {
		[StepperKinds.STORAGE]: { desc: "Storage for standalone HTML output", parse: stringOrError },
	};

	/**
	 * Tunable bounds on the event-buffer cap. A consumer under memory
	 * pressure may shrink MAX_EVENTS; under slack, grow it. Rate-limited to
	 * at most 48 changes per day to prevent oscillation.
	 */
	tunables = {
		MAX_EVENTS: {
			desc: "Cap on the monitor's in-memory event buffer (and observation-quads buffer). Default: 10000.",
			parse: intOrError,
			range: { kind: "number" as const, min: 100, max: 1_000_000 },
			rateLimit: { maxChangesPerDay: 48 },
		},
	};

	private get transport(): ITransport | undefined {
		return this.getWorld().runtime[TRANSPORT] as ITransport | undefined;
	}

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
		// Initial tunable read via the shared option-reading path plus this
		// tunable's own declared `parse`. Live updates (when a consumer
		// writes a change targeting MAX_EVENTS) will arrive as
		// tunable-change events once that path exists.
		const raw = getStepperOption(this, "MAX_EVENTS", world.moduleOptions);
		if (raw !== undefined) {
			const parsed = this.tunables.MAX_EVENTS.parse(String(raw));
			if (parsed.result !== undefined) this.maxEvents = parsed.result;
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
		startFeature: async () => {
			const webserver = this.getWorld().runtime[WEBSERVER] as IWebServer;
			const artifactDir = resolve(this.storage.getArtifactBasePath());
			await this.storage.ensureDirExists(artifactDir);
			webserver.addKnownStaticFolder(artifactDir, "/artifacts");
		},
		onEvent: (event: THaibunEvent) => {
			this.events.push(event);
			if (this.events.length > this.maxEvents) this.events.shift();
			const e = event as Record<string, unknown>;
			if (e.kind === "artifact" && e.artifactType === "json") {
				const q = (e.json as { quadObservation?: TQuad })?.quadObservation;
				if (q?.subject && q.predicate && q.namedGraph) {
					this.observationQuads.push({ subject: q.subject, predicate: q.predicate, object: q.object, namedGraph: q.namedGraph, timestamp: q.timestamp ?? (e.timestamp as number) ?? Date.now(), properties: q.properties });
					if (this.observationQuads.length > this.maxEvents) this.observationQuads.shift();
				}
			}
			this.transport?.send({ type: "event", event });
		},
		endFeature: async ({ shouldClose = true }: TEndFeature) => {
			// `saves shu to <path>` is an explicit user request; honor it regardless of HAIBUN_STAY (shouldClose=false).
			const hasFixedPath = !!this.outputPath;
			if (!hasFixedPath && !shouldClose) return;
			if (!hasFixedPath && !this.storage) return;
			const rpcCache = (this.getWorld().runtime[RPC_CACHE] ?? {}) as Record<string, unknown>;
			// Ensure essential data is always available offline:
			// 1. Events (the test execution log — core of the monitor view)
			if (!rpcCache["MonitorStepper-getEvents"]) {
				rpcCache["MonitorStepper-getEvents"] = { events: this.events };
			}
			// 2. Parameterless steps with view products (deterministic view toggles)
			const candidates = Object.entries(this.steps).filter(([name, step]) => !rpcCache[`MonitorStepper-${name}`] && !step.gwta.includes("{"));
			const logger = this.getWorld().eventLogger;
			await Promise.all(
				candidates.map(async ([name, step]) => {
					try {
						const r = (await (step.action as () => unknown)()) as { products?: Record<string, unknown> } | undefined;
						const products = r?.products;
						if (products?.view) rpcCache[`MonitorStepper-${name}`] = products;
					} catch (err) {
						logger.warn(`[shu endFeature] step ${name} failed: ${err instanceof Error ? err.message : err}`);
					}
				}),
			);
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
			const extraScripts = Object.values(this.getWorld().domains)
				.map((d) => (d?.ui as Record<string, unknown> | undefined)?.jsContent)
				.filter((c): c is string => typeof c === "string" && c.length > 0);
			let html = buildSpaHtml(".", bundle, hydration, extraScripts);
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
			action: () => actionOKWithProducts({ _type: "view", _summary: "Monitor log stream", _component: "shu-monitor-column", view: "monitor" }),
		},
		showSequenceDiagram: {
			gwta: "show sequence diagram",
			action: () => actionOKWithProducts({ _type: "view", _summary: "Sequence diagram", _component: "shu-sequence-diagram", view: "sequence" }),
		},
		showDocument: {
			gwta: "show document",
			action: () => actionOKWithProducts({ _type: "view", _summary: "Document view", _component: "shu-document-column", view: "document" }),
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
					events: filtered.map(({ source: _s, emitter: _e, ...e }) => {
						const event = { ...e, seqPath: parseSeqPath(e.id) } as Record<string, unknown>;
						// Strip inline file content — SPA fetches via /artifacts/ path reference
						if (e.kind === "artifact") delete event.content;
						return event;
					}),
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
			action: () => actionOKWithProducts({ _type: "view", _summary: "Graph view", _component: "shu-graph-view", view: "graph" }),
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
		getClusteredQuads: {
			gwta: "get clustered quads",
			outputSchema: z.object({
				quads: z.array(z.unknown()),
				clusters: z.array(
					z.object({
						type: z.string(),
						totalCount: z.number(),
						sampledCount: z.number(),
						omittedCount: z.number(),
						sampledSubjects: z.array(z.string()),
						displayLabels: z.record(z.string(), z.string()).optional(),
					}),
				),
			}),
			action: async (args: { perTypeLimit?: number | string; types?: string[] | string } = {}) => {
				const store = this.getWorld().shared.getStore();
				// RPC params arrive stringified through the synthetic-step plumbing; coerce both back to native shapes.
				const limitNum = typeof args.perTypeLimit === "string" ? Number(args.perTypeLimit) : args.perTypeLimit;
				const perTypeLimit = Math.max(1, Math.min(10000, Number.isFinite(limitNum) ? (limitNum as number) : 100));
				let types: string[] | undefined;
				if (Array.isArray(args.types)) types = args.types;
				else if (typeof args.types === "string" && args.types.length > 0) {
					try {
						const parsed: unknown = JSON.parse(args.types);
						if (Array.isArray(parsed)) types = parsed.map(String);
					} catch (err) {
						this.getWorld().eventLogger.warn(`getClusteredQuads: ignoring non-JSON 'types' param: ${err instanceof Error ? err.message : err}`);
					}
				}
				if (!store.getClusteredQuads) {
					return actionNotOK("QuadStore does not support getClusteredQuads");
				}
				const result = await store.getClusteredQuads({ perTypeLimit, types });
				const quads = [...result.quads, ...this.observationQuads]
					.map(({ subject, predicate, object, namedGraph, timestamp, properties }) => ({ subject, predicate, object, namedGraph, timestamp, properties }));
				return actionOKWithProducts({ quads, clusters: result.clusters });
			},
		},
	} satisfies TStepperSteps;
}
