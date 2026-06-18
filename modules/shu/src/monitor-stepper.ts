/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "path";
import { z } from "zod";
import { writeFileSync } from "fs";
import { gzipSync } from "node:zlib";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import type { IHasTunables } from "@haibun/core/lib/tunables.js";
import { AccessLevelSchema } from "@haibun/core/lib/resources.js";
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
import { loadReportBundle, buildReportHtml, buildGraphSource } from "./shu-stepper.js";
import { GET_EVENTS_METHOD, CLUSTERED_QUADS_METHOD } from "./rpc-cache.js";
import { rpcCacheKeyParams } from "@haibun/core/lib/rpc-cache-key.js";
import { RPC_CACHE } from "@haibun/web-server-hono/web-server-stepper.js";

import { DOMAIN_GRAPH_QUERY, GraphQuerySchema } from "@haibun/core/lib/quad-types.js";

const MAX_EVENTS_DEFAULT = 9e9;
// The live getEvents response is a recent window, never the whole buffer: a long instrumentation run accumulates events
// until JSON.stringify hits V8's ~512MB ceiling and the RPC 413s. Bound by BYTES (a few large events can't blow it) and a
// hard count, both well under the ceiling. The SSE stream delivers the live tail; a consumer pages older history via `since`.
const EVENTS_BYTE_BUDGET = 16 * 1024 * 1024; // 16MB of slimmed-event JSON
const EVENTS_COUNT_CAP = 20000; // hard ceiling on returned count regardless of size

type TReportEvent = Record<string, unknown>;

/** Event `products` reduced to the subfields the offline views read (column reconstruction + display caption). */
function slimReportProducts(products: Record<string, unknown>): Record<string, unknown> | undefined {
	const keep: Record<string, unknown> = {};
	for (const f of ["view", "_component", "_type", "_summary"]) if (products[f] !== undefined) keep[f] = products[f];
	return Object.keys(keep).length ? keep : undefined;
}

/**
 * Slim one event for the offline report. Debug-level artifacts (the per-quad observations, ~all of the bulk) are dropped
 * entirely — they feed the live graph via SSE, but the offline graph renders from the embedded clustered quads, and the
 * offline event stream is never replayed. `stepValuesMap` is dropped and `products` reduced to its display subfields.
 */
function slimReportEvent(e: TReportEvent): TReportEvent | null {
	if (e.kind === "artifact" && e.level === "debug") return null;
	const out: TReportEvent = { ...e };
	delete out.stepValuesMap;
	if (out.products) out.products = slimReportProducts(out.products as Record<string, unknown>);
	return out;
}

/** Strip the live-only fields (source/emitter), drop inline artifact content (the SPA fetches artifacts by /artifacts/ path), and attach the parsed seqPath — the shape getEvents returns. */
export function slimLiveEvent(e: THaibunEvent): Record<string, unknown> {
	const { source: _s, emitter: _e, ...rest } = e;
	const event = { ...rest, seqPath: parseSeqPath(e.id) } as Record<string, unknown>;
	if (e.kind === "artifact") delete event.content;
	return event;
}

/** The most recent slimmed events that fit a byte budget and a count cap, in chronological order — so the response can never approach the serialize ceiling. The newest event is always included even if it alone exceeds the budget; `truncated` reports any drop. */
export function recentEventsWithinBudget(events: THaibunEvent[], countCap: number, byteBudget: number): { events: Record<string, unknown>[]; truncated: boolean } {
	const out: Record<string, unknown>[] = [];
	let bytes = 0;
	let truncated = false;
	for (let i = events.length - 1; i >= 0; i--) {
		if (out.length >= countCap) {
			truncated = true;
			break;
		}
		const slim = slimLiveEvent(events[i]);
		const size = JSON.stringify(slim).length;
		if (out.length > 0 && bytes + size > byteBudget) {
			truncated = true;
			break;
		}
		bytes += size;
		out.push(slim);
	}
	return { events: out.reverse(), truncated };
}

/**
 * Component JS to inline in the offline report: a domain's `ui.jsContent`, but only for components whose view is in the
 * final report (the columns shown at endFeature). A heavy external-component bundle is embedded only when its view is
 * actually shown, and never paid for otherwise. Pure + exported so the inclusion rule is unit-tested.
 */
export function inlineScriptsForView(domains: Record<string, unknown>, finalViewComponents: Set<string>): string[] {
	return Object.values(domains)
		.map((d) => (d as { ui?: { component?: string; jsContent?: string } } | undefined)?.ui)
		.filter(
			(u): u is { component: string; jsContent: string } =>
				typeof u?.jsContent === "string" && u.jsContent.length > 0 && typeof u.component === "string" && finalViewComponents.has(u.component),
		)
		.map((u) => u.jsContent);
}

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

/** Optional filter for getEvents — by level, kind, minimum timestamp, and a max count (clamped to a server cap). */
export const EventsFilterSchema = z.object({
	level: z.string().optional(),
	kind: z.string().optional(),
	since: z.number().optional(),
	limit: z.number().optional(),
});
export type TEventsFilter = z.infer<typeof EventsFilterSchema>;

// `total` is the count matching the filter; `events` may be a recent window of it (see EVENTS_BYTE_BUDGET) with `truncated` set.
const MonitorEventsSchema = z.object({ events: z.array(z.unknown()), total: z.number().optional(), truncated: z.boolean().optional() });

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
			desc: "Limit on the monitor's in-memory event buffer (and observation-quads buffer). Default: 10000.",
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
		// Read the initial MAX_EVENTS tunable via the shared option path and this
		// tunable's own declared `parse`.
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
						objectType: q.objectType,
						timestamp: q.timestamp ?? (e.timestamp as number) ?? Date.now(),
						properties: q.properties,
					});
					if (this.observationQuads.length > this.maxEvents) this.observationQuads.shift();
				}
			}
			this.transport?.send({ type: "event", event });
		},
		endFeature: async ({ shouldClose = true }: TEndFeature) => {
			// An explicit `saves shu to <path>` step is honored regardless of HAIBUN_STAY (shouldClose=false).
			const hasFixedPath = !!this.outputPath;
			if (!hasFixedPath && !shouldClose) return;
			if (!hasFixedPath && !this.storage) return;
			await this.writeStandaloneReport({ fixedPath: this.outputPath });
			// Each feature's report stands alone: clear the per-feature buffers so the next feature's report (and the live
			// getEvents backfill) holds only its own events — and serialized artifacts resolve from the report's own dir.
			// Live SSE streaming is unaffected; events forward as they happen.
			this.events = [];
			this.observationQuads = [];
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
		// 1. Events — embed one complete end-of-run copy under the bare key; drop the per-filter copies the live run
		//    cached (getCachedResponse serves the bare copy for any filter; the views filter themselves).
		for (const key of Object.keys(rpcCache)) if (key.startsWith(`${GET_EVENTS_METHOD}:`)) delete rpcCache[key];
		rpcCache[GET_EVENTS_METHOD] = { events: this.events };
		// 2. Parameterless steps with view products (deterministic view toggles). Exclude getClusteredQuads: it's the graph
		//    DATA RPC, not a view toggle (no `.view` product), it requires an accessLevel by design (no default — it honors
		//    the caller's access exactly), and it's baked canonically below via buildGraphSource. Running it here arg-less
		//    only threw on the missing accessLevel; its bare-key bake lands after this loop, so the early-cache guard misses it.
		const candidates = Object.entries(this.steps).filter(
			([name, step]) => !rpcCache[`MonitorStepper-${name}`] && !step.gwta.includes("{") && `MonitorStepper-${name}` !== CLUSTERED_QUADS_METHOD,
		);
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
		// 3. End-of-run snapshots for the affordances panel. Earlier RPC calls cached
		// the early empty-graph state; the panel's offline render uses the cache, so the
		// last live snapshot is the one that matters. Re-run the parameterless producers
		// to overwrite with end-of-run forward / goals / waypoints.
		const steppers = (this.getWorld().runtime.steppers as AStepper[] | undefined) ?? [];
		for (const stepper of steppers) {
			const refreshable = ["showWaypoints", "showAffordances"];
			for (const name of refreshable) {
				const step = stepper.steps?.[name];
				if (!step || typeof (step as { action?: unknown }).action !== "function") continue;
				const key = `${stepper.constructor.name}-${name}`;
				try {
					const r = (await (step as { action: (a: Record<string, unknown>) => unknown }).action({})) as { products?: Record<string, unknown> } | undefined;
					if (r?.products) rpcCache[key] = r.products;
				} catch (err) {
					logger.warn(`[shu writeStandaloneReport] ${key} refresh failed: ${err instanceof Error ? err.message : err}`);
				}
			}
		}
		// Bake the FULL graph as ONE canonical getClusteredQuads response, exactly like the live RPC — the offline overview
		// and sequence views paint client-side from this quad set and hide instrumentation by default themselves (toggleable),
		// so there is no server-rendered image to embed and the offline filter behaves identically to live.
		const built = await buildGraphSource(this.getWorld());
		// Drop the live run's many per-params getClusteredQuads copies; offline serves only this canonical snapshot, so every
		// view that reads the snapshot sees the same graph.
		for (const key of Object.keys(rpcCache)) if (key === CLUSTERED_QUADS_METHOD || key.startsWith(`${CLUSTERED_QUADS_METHOD}:`)) delete rpcCache[key];
		if (built) rpcCache[CLUSTERED_QUADS_METHOD] = { quads: built.quads, clusters: built.clusters };
		else logger.warn("[shu writeStandaloneReport] graph snapshot not baked: QuadStore has no getClusteredQuads; the offline graph will be unavailable");
		// Reconstruct view hash from events (view products) and cache (last query label).
		// `view` is the productsDomain key (e.g. "affordances"); pane-state expects the
		// component tag (e.g. "shu-affordances-panel"). Resolve via the registered domain's
		// `ui.component` so the offline file uses the same vocabulary as live runs.
		const domains = this.getWorld().domains;
		const cols: string[] = [];
		let label = "";
		for (const e of this.events) {
			const ev = e as Record<string, unknown>;
			if (ev.kind !== "lifecycle" || ev.stage !== "end") continue;
			const view = (ev.products as Record<string, unknown>)?.view;
			if (typeof view !== "string") continue;
			const component = (domains[view]?.ui as { component?: string } | undefined)?.component ?? view;
			if (!cols.includes(component)) cols.push(component);
		}
		for (const key of Object.keys(rpcCache)) {
			if (!key.includes("graphQuery:")) continue;
			try {
				const params = rpcCacheKeyParams(key) as { query?: { label?: string } } | undefined;
				if (params?.query?.label) label = params.query.label;
			} catch {
				/* */
			}
		}
		const hashParts = new URLSearchParams();
		if (label) hashParts.set("label", label);
		for (const col of cols) hashParts.append("col", col);
		const viewHash = hashParts.toString() ? `#?${hashParts.toString()}` : "";
		// Slim the embedded events to what the offline document reads (log/lifecycle narrative): drop the bulk per-quad
		// debug artifacts, stepValuesMap, and reduce products to display subfields. The whole payload is then compressed.
		const getEvents = rpcCache[GET_EVENTS_METHOD] as { events?: TReportEvent[] } | undefined;
		if (getEvents?.events) getEvents.events = getEvents.events.map(slimReportEvent).filter((e): e is TReportEvent => e !== null);
		// `events` lives only in the rpcCache (getEvents); hydrateFromDom reads rpcCache + viewHash, never a top-level events field.
		const hydration = JSON.stringify({ rpcCache, viewHash });
		const scripts = inlineScriptsForView(this.getWorld().domains, new Set(cols));
		let payload = JSON.stringify({ bundle: loadReportBundle(), hydration, scripts });
		const secrets = await this.getWorld().shared.getSecrets();
		for (const [, value] of Object.entries(secrets)) if (value) payload = payload.replaceAll(value, OBSCURED_VALUE);
		const html = buildReportHtml(".", gzipSync(payload).toString("base64"));
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
				const { level, kind, since, limit } = filter;
				let filtered: THaibunEvent[] = this.events;
				if (level) filtered = filtered.filter((e) => e.level === level);
				if (kind) filtered = filtered.filter((e) => e.kind === kind);
				if (since) filtered = filtered.filter((e) => e.timestamp >= since);
				const cap = limit && limit > 0 ? Math.min(limit, EVENTS_COUNT_CAP) : EVENTS_COUNT_CAP;
				const { events, truncated } = recentEventsWithinBudget(filtered, cap, EVENTS_BYTE_BUDGET);
				return actionOKWithProducts({ events, total: filtered.length, truncated });
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
				else if (level === "debug") this.getWorld().eventLogger.debug(line, attributes);
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
			action: async (args: { perTypeLimit?: number | string; types?: string[] | string; accessLevel?: string } = {}) => {
				const store = this.getWorld().shared.getStore();
				// RPC params arrive stringified through the synthetic-step plumbing; coerce both back to native shapes.
				const limitNum = typeof args.perTypeLimit === "string" ? Number(args.perTypeLimit) : args.perTypeLimit;
				const perTypeLimit = Math.max(1, Math.min(10000, Number.isFinite(limitNum) ? (limitNum as number) : 100));
				// Required, same as the dereference/query paths — no default ceiling, so the cluster view honors the caller's access exactly.
				const accessLevel = AccessLevelSchema.parse(args.accessLevel);
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
				const result = await store.getClusteredQuads({ perTypeLimit, types, accessLevel });
				// The store is canonical; only surface observation quads whose
				// (namedGraph,subject,predicate,object) isn't already in the store result,
				// so each fact appears exactly once.
				const quadKey = ({ namedGraph, subject, predicate, object }: TQuad) => JSON.stringify([namedGraph, subject, predicate, object]);
				const seen = new Set(result.quads.map(quadKey));
				const unique = this.observationQuads.filter((q) => !seen.has(quadKey(q)));
				const quads = [...result.quads, ...unique].map(({ subject, predicate, object, objectType, namedGraph, timestamp, properties }) => ({
					subject,
					predicate,
					object,
					objectType,
					namedGraph,
					timestamp,
					properties,
				}));
				return actionOKWithProducts({ quads, clusters: result.clusters });
			},
		},
	} satisfies TStepperSteps;
}
