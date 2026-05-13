/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "path";
import { z } from "zod";
import { writeFileSync } from "fs";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import type { IHasTunables } from "@haibun/core/lib/tunables.js";
import { type TWorld } from "@haibun/core/lib/world.js";
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

const MAX_EVENTS_DEFAULT = 9e9;

export const DOMAIN_LOG_EVENT = "shu-log-event";

/** Client-side log event forwarded from the SPA. Validated with Zod at the action boundary. */
export const LogEventSchema = z.object({
	level: z.enum(["debug", "trace", "info", "warn", "error"]).default("info"),
	message: z.string().min(1),
	source: z.string().optional(),
	attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TLogEvent = z.infer<typeof LogEventSchema>;

export const DOMAIN_EVENTS_FILTER = "shu-events-filter";

/** Optional filter for getEvents — by level, kind, and minimum timestamp. */
export const EventsFilterSchema = z.object({
	level: z.string().optional(),
	kind: z.string().optional(),
	since: z.number().optional(),
});
export type TEventsFilter = z.infer<typeof EventsFilterSchema>;

const MonitorEventsSchema = z.object({ events: z.array(z.unknown()) });

const DispatchTracesSchema = z.object({ traces: z.array(z.unknown()) });

const ClusteredQuadsSchema = z.object({
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
});

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
				{
					selectors: [DOMAIN_LOG_EVENT],
					schema: LogEventSchema,
					coerce: objectCoercer(LogEventSchema),
					description: "Client-side log event forwarded from the SPA",
				},
				{
					selectors: [DOMAIN_EVENTS_FILTER],
					schema: EventsFilterSchema,
					coerce: objectCoercer(EventsFilterSchema),
					description: "Optional filter for monitor events query",
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
					this.observationQuads.push({
						subject: q.subject,
						predicate: q.predicate,
						object: q.object,
						namedGraph: q.namedGraph,
						timestamp: q.timestamp ?? (e.timestamp as number) ?? Date.now(),
						properties: q.properties,
					});
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
			await this.writeStandaloneReport({ fixedPath: this.outputPath });
		},
	};

	/**
	 * Build the standalone HTML report from the live event/quad buffers and write it.
	 * Callable any time during a feature so a feature can capture a snapshot at a
	 * chosen point — `saves shu to <path>` triggers a write, and `endFeature` writes
	 * once more so the final state always reflects the full run.
	 */
	private async writeStandaloneReport({ fixedPath }: { fixedPath?: string }): Promise<string> {
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
					logger.warn(`[shu writeStandaloneReport] step ${name} failed: ${err instanceof Error ? err.message : err}`);
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
		if (fixedPath) {
			writeFileSync(fixedPath, html);
			logger.info(`shu standalone report: ${actualURI(fixedPath)}`);
			return fixedPath;
		}
		const saved = await this.storage.saveArtifact("shu.html", html, EMediaTypes.html);
		logger.info(`shu standalone report: ${actualURI(saved.absolutePath)}`);
		return saved.absolutePath;
	}

	steps = {
		savesShuTo: {
			gwta: "saves shu to {where: string}",
			description:
				"Write the standalone shu HTML report to the given path. Invokable any time during a feature; endFeature writes once more so the final file always reflects the full run.",
			action: async ({ where }: { where: string }) => {
				this.outputPath = where;
				const written = await this.writeStandaloneReport({ fixedPath: where });
				return actionOKWithProducts({ path: written });
			},
		},
		// Singleton view openers. Hypermedia markers (`_type` + `_component` + `id` + `view`
		// + `_summary`) are injected by the dispatcher from each domain's `ui.component`,
		// so every view-opening step shares the same single mechanism.
		showMonitor: {
			gwta: "show monitor",
			productsDomain: "shu-monitor-column",
			action: () => actionOKWithProducts({}),
		},
		showSequenceDiagram: {
			gwta: "show sequence diagram",
			productsDomain: "shu-sequence-diagram",
			action: () => actionOKWithProducts({}),
		},
		showDocument: {
			gwta: "show document",
			productsDomain: "shu-document-column",
			action: () => actionOKWithProducts({}),
		},
		getEvents: {
			gwta: `get monitor events {filter: ${DOMAIN_EVENTS_FILTER}}`,
			productsSchema: MonitorEventsSchema,
			action: ({ filter }: { filter: TEventsFilter }) => {
				const { level, kind, since } = filter;
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
		logClient: {
			gwta: `log client {event: ${DOMAIN_LOG_EVENT}}`,
			action: ({ event }: { event: TLogEvent }) => {
				const { level, message, source, attributes } = event;
				const prefix = source ? `[${source}] ` : "";
				const line = `${prefix}${message}`;
				if (level === "warn") this.getWorld().eventLogger.warn(line, attributes);
				else if (level === "error") this.getWorld().eventLogger.error(line, attributes);
				else this.getWorld().eventLogger.info(line, attributes);
				return actionOKWithProducts({});
			},
		},
		getDispatchTraces: {
			gwta: "get dispatch traces",
			productsSchema: DispatchTracesSchema,
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
			productsDomain: "shu-graph-view",
			action: () => actionOKWithProducts({}),
		},
		getClusteredQuads: {
			gwta: "get clustered quads",
			productsSchema: ClusteredQuadsSchema,
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
				const quads = [...result.quads, ...this.observationQuads].map(({ subject, predicate, object, namedGraph, timestamp, properties }) => ({
					subject,
					predicate,
					object,
					namedGraph,
					timestamp,
					properties,
				}));
				return actionOKWithProducts({ quads, clusters: result.clusters });
			},
		},
	} satisfies TStepperSteps;
}
