/**
 * MonitorStepper — Buffers execution events and forwards them via SSE transport.
 * Works with any config that has @haibun/web-server-hono (shared transport).
 * The shu frontend receives events via SSE for live updates and fetches history via RPC.
 * At endFeature, writes a standalone HTML file with embedded events, quads, and concerns.
 */
import { resolve } from "path";
import { z } from "zod";
import { writeFileSync, appendFileSync, readFileSync, existsSync, rmSync, openSync, readSync, closeSync, fstatSync, statSync } from "fs";

import { AStepper, type IHasCycles, type IHasOptions, type TStepperSteps, StepperKinds, CycleWhen, type TEndFeature, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import type { IHasTunables } from "@haibun/core/lib/tunables.js";
import { Access, AccessLevelSchema, AccessQueryLevelSchema, storeScopeFor } from "@haibun/core/lib/resources.js";
import { recordBlip } from "@haibun/core/lib/blips.js";
// The view vocabulary declares itself at import, so an arriving batch finds its names already declared here.
import "./view-blips.js";
import { type TWorld } from "@haibun/core/lib/world.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { HAIBUN_LOG_LEVELS, HaibunLogLevel } from "@haibun/core/schema/protocol.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { OBSCURED_VALUE } from "@haibun/core/lib/feature-variables.js";
import { actionNotOK, actionOKWithProducts, getStepperOption, intOrError, stringOrError, findStepperFromOptionOrKind, errorDetail } from "@haibun/core/lib/util/index.js";
import { actualURI } from "@haibun/core/lib/util/node/actualURI.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";
import { TRANSPORT, type ITransport } from "@haibun/web-server-hono/sse-transport.js";
import { WEBSERVER, type IWebServer } from "@haibun/web-server-hono/defs.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { buildConcernCatalog, buildResourceRels } from "@haibun/core/lib/hypermedia.js";
import { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { loadReportBundle, buildReportHtml, buildGraphSource } from "./shu-stepper.js";
import { GET_EVENTS_METHOD, CLUSTERED_QUADS_METHOD } from "./rpc-cache.js";
import { rpcCacheKeyParams } from "@haibun/core/lib/rpc-cache-key.js";
import { RPC_CACHE } from "@haibun/web-server-hono/web-server-stepper.js";

import { DOMAIN_GRAPH_QUERY, type TGraphQuery } from "@haibun/core/lib/quad-types.js";
import { withOntologySchema } from "./graph/ontology-projection.js";
import { enumerateStandardVocab } from "./graph/standard-vocabulary.js";
import { activeSitePrincipal, adoptSitePrincipal, hasDefaultSitePrincipal } from "@haibun/core/lib/host-id.js";
import { persistPrincipalIndividual } from "@haibun/core/lib/principal-individual.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { RemoteGraphSource } from "./remote-graph-source.js";

/** Result of the inherent `graphQuery` step: matched rows + their count. */
const GraphQueryResultSchema = z.object({ vertices: z.array(z.record(z.string(), z.unknown())), total: z.number().int().nonnegative() });

// The in-memory buffers hold a recent WINDOW, never the run: over months, an unbounded buffer is the process's heap
// death (a first-time index of a large mailbox OOMed the daemon at ~4GB). The store is canonical for graph data and
// the disk log for event history; these buffers only serve live backfill and the live cluster extension.
const MAX_EVENTS_DEFAULT = 5000;
/** Buffers trim in amortized bulk (splice once past max+slack), not shift-per-event — a per-event O(max) memmove on the hot observation path. */
const BUFFER_TRIM_SLACK = 500;
// The live getEvents response is a recent window, never the whole buffer: a long instrumentation run accumulates events
// until JSON.stringify hits V8's ~512MB ceiling and the RPC 413s. Bound by BYTES (a few large events can't blow it) and a
// hard count, both well under the ceiling. The SSE stream delivers the live tail; a consumer pages older history via `since`.
const EVENTS_BYTE_BUDGET = 16 * 1024 * 1024; // 16MB of slimmed-event JSON
const EVENTS_COUNT_CAP = 20000; // hard ceiling on returned count regardless of size
const EVENT_LOG_FLUSH_BATCH = 256; // buffer lean events and append in batches so the disk log never does sync I/O per event
/** How much of the disk log is read at a time when a page is served from it, from the end backward. Bounds the memory a
 *  page over a log of any size costs: one chunk plus the page itself, never the whole log. */
const EVENT_LOG_READ_CHUNK = 1024 * 1024;

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
	return takeRecentWithinBudget(newestFirst(events), countCap, byteBudget);
}

/** The events of `source` that `keep` accepts, in the source's order, without collecting it. */
function* filterIterable<T>(source: Iterable<T>, keep: (item: T) => boolean): Generator<T> {
	for (const item of source) if (keep(item)) yield item;
}

/** An array's events newest first, without copying it. */
function* newestFirst(events: THaibunEvent[]): Generator<THaibunEvent> {
	for (let i = events.length - 1; i >= 0; i--) yield events[i];
}

/** Take events, newest first, until the count cap or the byte budget is reached; `truncated` says a further event existed
 *  past the page. The source decides where the events come from (the live buffer, or the disk log read backward); this is
 *  the one bound every page has. */
export function takeRecentWithinBudget(source: Iterable<THaibunEvent>, countCap: number, byteBudget: number): { events: Record<string, unknown>[]; truncated: boolean } {
	const out: Record<string, unknown>[] = [];
	let bytes = 0;
	let truncated = false;
	for (const event of source) {
		if (out.length >= countCap) {
			truncated = true;
			break;
		}
		const slim = slimLiveEvent(event);
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

export const DOMAIN_CLIENT_BLIPS = "shu-client-blips";

/** A batch of fine-grained occurrences the SPA recorded and handed over together, since one request each is not
 *  affordable at the rate they happen. `recorded` is everything the page has recorded, so a batch a full buffer
 *  truncated says so rather than reading as the whole. */
export const ClientBlipsSchema = z.object({
	blips: z.array(z.object({ name: z.string(), value: z.number().optional(), attributes: z.record(z.string(), z.unknown()).optional(), at: z.number() })),
	recorded: z.number().optional(),
});
export type TClientBlips = z.infer<typeof ClientBlipsSchema>;

export const DOMAIN_EVENTS_FILTER = "shu-events-filter";

/** Optional filter for getEvents — by level, kind, timestamp window (`since`..`until`, both inclusive), and a max count (clamped to a server cap). `until` lets a client page backward through the byte-bounded window to retrieve the full history. */
export const EventsFilterSchema = z.object({
	level: z.string().optional(),
	kind: z.string().optional(),
	since: z.number().optional(),
	until: z.number().optional(),
	limit: z.number().optional(),
	/** One step's own events, by its seqPath (dot-joined): its start and end, which share it as their id, and the trace of
	 *  its dispatch, named for it. A view about one step asks for these alone, from the buffer or the run's log. */
	seqPath: z.string().optional(),
	/** Events at this level or above (the rule every log view filters by), so a view that shows `log` and up pages its own
	 *  tail rather than a tail of every level that may hold nothing it shows. */
	minLevel: HaibunLogLevel.optional(),
	/** A page by INDEX among the events at `minLevel` and up, oldest first: the events whose index at that level is in
	 *  [offset, offset + limit). This is how a view whose rail spans the whole run pages any region of it in. */
	offset: z.number().optional(),
});
export type TEventsFilter = z.infer<typeof EventsFilterSchema>;

// `total` is the count matching the filter; `events` may be a recent window of it (see EVENTS_BYTE_BUDGET) with `truncated` set.
/** What a page carries beside its events: `total`, how many events the run holds at the asked level (its whole extent);
 *  `first`, when the run's first event happened; `truncated`, whether older events exist past a time-paged page. */
const MonitorEventsSchema = z.object({ events: z.array(z.unknown()), total: z.number().optional(), first: z.number().optional(), truncated: z.boolean().optional(), run: z.string().optional() });

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
			// Site principal per sampled subject SERVED BY A FEDERATED PEER; a subject without an entry was served by `site` below.
			sites: z.record(z.string(), z.string()).optional(),
		}),
	),
	// The responding instance's site principal — the serving site of every subject not overridden per-cluster.
	site: z.string().optional(),
});

export default class MonitorStepper extends AStepper implements IHasCycles, IHasOptions, IHasTunables {
	description = "Buffers execution events for the shu monitor view";
	private events: THaibunEvent[] = [];
	private observationQuads: TQuad[] = [];
	/** Occurrences accepted from the SPA, so a page whose buffer overflowed between batches can be told apart from a quiet one. */
	private clientBlipsReceived = 0;
	/** Per-run lean event log (full history, JSONL on disk). The report reads ALL of it (never truncated); the in-memory
	 *  `events` buffer is only a bounded window for the live backfill. fs, not AStorage — AStorage has no append, and this
	 *  mirrors the existing writeFileSync report write. */
	private eventLogPath: string | null = null;
	private diskBuffer: string[] = [];
	private storage!: AStorage;
	private outputPath?: string;
	private maxEvents: number = MAX_EVENTS_DEFAULT;
	/** Whether the live buffer has dropped its oldest events — the run extends further back than `events` holds. */
	private eventsTrimmed = false;
	/** The run being recorded: begun at startFeature, stamped on every event and every answer, so a client holding events
	 *  of an earlier run (a stayed instance run again, a device store from yesterday) can tell them apart and show one run. */
	private runId: string | undefined;
	/** How many events the run's log holds at each level and up: the extent a view at that level spans. */
	private levelCounts: Record<string, number> = {};
	/** When the run's first logged event happened. */
	private firstLoggedAt: number | undefined;
	/** Where each flushed batch begins in the log and how many events at each level precede it, so a page by index seeks
	 *  to its batch and reads forward from there rather than from the start of the log. */
	private logIndex: Array<{ offset: number; counts: Record<string, number> }> = [];
	/** buildResourceRels walks every domain; memoized by domain count so per-RPC calls reuse it while a runtime-declared domain still invalidates. */
	private relsCache?: { rels: ReturnType<typeof buildResourceRels>; size: number };
	private resourceRels(): ReturnType<typeof buildResourceRels> {
		const domains = this.getWorld().domains;
		const size = Object.keys(domains).length;
		if (!this.relsCache || this.relsCache.size !== size) this.relsCache = { rels: buildResourceRels(domains), size };
		return this.relsCache.rels;
	}
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
					selectors: [DOMAIN_LOG_EVENT],
					schema: LogEventSchema,
					coerce: objectCoercer(LogEventSchema),
					description: "Client-side log event forwarded from the SPA",
				},
				{
					selectors: [DOMAIN_CLIENT_BLIPS],
					schema: ClientBlipsSchema,
					coerce: objectCoercer(ClientBlipsSchema),
					description: "A batch of fine-grained occurrences recorded in the SPA",
				},
				{
					selectors: [DOMAIN_EVENTS_FILTER],
					schema: EventsFilterSchema,
					coerce: objectCoercer(EventsFilterSchema),
					description: "Optional filter for monitor events query",
				},
			],
		}),
		startFeature: () => {
			const webserver = this.getWorld().runtime[WEBSERVER] as IWebServer;
			const artifactDir = resolve(this.storage.getArtifactBasePath());
			this.storage.ensureDirExists(artifactDir);
			webserver.addKnownStaticFolder(artifactDir, "/artifacts");
			// Per-run lean event log (the report's full-history source). Start fresh so a re-run never appends to a stale log.
			this.eventLogPath = resolve(artifactDir, "events.jsonl");
			if (existsSync(this.eventLogPath)) rmSync(this.eventLogPath);
			this.runId = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
			this.levelCounts = {};
			this.firstLoggedAt = undefined;
			this.logIndex = [];
		},
		onEvent: (event: THaibunEvent) => {
			const e = event as Record<string, unknown>;
			const quad = e.kind === "artifact" && e.artifactType === "json" ? (e.json as { quadObservation?: TQuad })?.quadObservation : undefined;
			if (quad?.subject && quad.predicate && quad.namedGraph) {
				// Graph data — kept only in the bounded observation buffer (feeds getClusteredQuads live + buildGraphSource
				// for the report). It must NOT also sit on the lean event log: it is the per-quad bulk. The live SPA still
				// receives it through the transport (SSE) for the live graph.
				this.observationQuads.push({
					subject: quad.subject,
					predicate: quad.predicate,
					object: quad.object,
					namedGraph: quad.namedGraph,
					objectType: quad.objectType,
					timestamp: quad.timestamp ?? (e.timestamp as number) ?? Date.now(),
					properties: quad.properties,
				});
				if (this.observationQuads.length > this.maxEvents + BUFFER_TRIM_SLACK) this.observationQuads.splice(0, this.observationQuads.length - this.maxEvents);
			} else this.recordEvent(event);
			this.transport?.send({ type: "event", event });
		},
		endFeature: async ({ shouldClose = true }: TEndFeature) => {
			// An explicit `saves shu to <path>` step is honored regardless of HAIBUN_STAY (shouldClose=false).
			const hasFixedPath = !!this.outputPath;
			if (!hasFixedPath && !shouldClose) return;
			if (!hasFixedPath && !this.storage) return;
			await this.writeStandaloneReport({ fixedPath: this.outputPath, compressed: true });
			// Each feature's report stands alone: clear the per-feature buffers so the next feature's report (and the live
			// getEvents backfill) holds only its own events — and serialized artifacts resolve from the report's own dir.
			// Live SSE streaming is unaffected; events forward as they happen.
			this.events = [];
			this.eventsTrimmed = false;
			this.levelCounts = {};
			this.firstLoggedAt = undefined;
			this.logIndex = [];
			this.observationQuads = [];
			this.diskBuffer = [];
			if (this.eventLogPath && existsSync(this.eventLogPath)) rmSync(this.eventLogPath);
		},
	};

	/**
	 * Build the standalone HTML report from the live event/quad buffers and write it.
	 * Callable any time during a feature so a feature can capture a snapshot at a
	 * chosen point — `saves shu to <path>` triggers a write, and `endFeature` writes
	 * once more so the final state always reflects the full run.
	 */
	/** Record one event: into the bounded live buffer (trimmed to the newest maxEvents) and onto the run's disk log,
	 *  which keeps every event. The buffer serves the live tail; the log is where a page past the buffer reads from. */
	private recordEvent(event: THaibunEvent): void {
		// An event the log keeps is given its index at every level it counts toward (its own and each below), the position
		// it has among the run's events at that level. A view at a level reads its whole extent by these: the rail spans
		// `levelCounts[level]` rows, and any region of it is a page by index. Stamped before the event is buffered, logged
		// or streamed, so every copy of it agrees. What the log does not keep (debug-level bulk) has no index: it is not
		// part of any view's extent.
		if (this.runId) (event as Record<string, unknown>).run = this.runId;
		const lean = slimReportEvent(slimLiveEvent(event));
		if (lean) {
			const idx: Record<string, number> = {};
			const own = HAIBUN_LOG_LEVELS.indexOf(event.level);
			for (const level of HAIBUN_LOG_LEVELS.slice(0, own + 1)) idx[level] = this.levelCounts[level] = (this.levelCounts[level] ?? 0) + 1;
			for (const level of Object.keys(idx)) idx[level]--; // counts are how many so far, an index is one less
			(event as Record<string, unknown>).idx = idx;
			(lean as Record<string, unknown>).idx = idx;
			this.firstLoggedAt ??= event.timestamp;
		}
		this.events.push(event);
		if (this.events.length > this.maxEvents + BUFFER_TRIM_SLACK) {
			this.events.splice(0, this.events.length - this.maxEvents);
			this.eventsTrimmed = true;
		}
		if (lean) this.appendToEventLog(lean);
	}

	/** Buffer a report-lean event for the disk log; flush in batches so the log never does sync I/O per event. */
	private appendToEventLog(lean: TReportEvent): void {
		this.diskBuffer.push(JSON.stringify(lean));
		if (this.diskBuffer.length >= EVENT_LOG_FLUSH_BATCH) this.flushEventLog();
	}

	/** Append the buffered lean events to the on-disk run log, recording where the batch begins and how many events at
	 *  each level precede it, so a page by index seeks to the batch it starts in. */
	private flushEventLog(): void {
		if (!this.eventLogPath || this.diskBuffer.length === 0) return;
		const offset = existsSync(this.eventLogPath) ? statSync(this.eventLogPath).size : 0;
		const before: Record<string, number> = {};
		// The counts before this batch: the running totals less what this batch holds at each level.
		for (const level of HAIBUN_LOG_LEVELS) before[level] = this.levelCounts[level] ?? 0;
		for (const line of this.diskBuffer) {
			const idx = (JSON.parse(line) as { idx?: Record<string, number> }).idx ?? {};
			for (const level of Object.keys(idx)) before[level]--;
		}
		this.logIndex.push({ offset, counts: before });
		appendFileSync(this.eventLogPath, `${this.diskBuffer.join("\n")}\n`);
		this.diskBuffer = [];
	}

	/** The run's lean events oldest first from the log, starting at the batch whose events at `level` begin at or before
	 *  `fromIndex`: the flush index says where that batch begins, the file is read forward from there a chunk at a time,
	 *  and the buffered lines follow. Stopping early (a page filled) reads no further. */
	private *leanEventsFromIndex(level: string, fromIndex: number, chunkBytes = EVENT_LOG_READ_CHUNK): Generator<TReportEvent> {
		let start = 0;
		for (const entry of this.logIndex) if ((entry.counts[level] ?? 0) <= fromIndex) start = entry.offset;
		if (this.eventLogPath && existsSync(this.eventLogPath)) {
			const fd = openSync(this.eventLogPath, "r");
			try {
				const size = fstatSync(fd).size;
				let position = start;
				let carry = Buffer.alloc(0); // the start of a line whose end is in the chunk after
				while (position < size) {
					const length = Math.min(chunkBytes, size - position);
					const chunk = Buffer.alloc(length);
					readSync(fd, chunk, 0, length, position);
					position += length;
					const joined = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
					const lastNewline = joined.lastIndexOf(0x0a);
					if (lastNewline === -1) {
						carry = joined;
						continue;
					}
					for (const line of joined.toString("utf8", 0, lastNewline).split("\n")) if (line) yield JSON.parse(line) as TReportEvent;
					carry = joined.subarray(lastNewline + 1);
				}
				const last = carry.toString("utf8");
				if (last) yield JSON.parse(last) as TReportEvent;
			} finally {
				closeSync(fd);
			}
		}
		for (const line of this.diskBuffer) yield JSON.parse(line) as TReportEvent;
	}

	/** The run's lean events newest first, without holding the log in memory: the lines still buffered (the newest), then
	 *  the file read from its end backward, `chunkBytes` at a time. A line split across two chunks is carried as bytes
	 *  until the chunk before it completes it, so a multibyte character on the boundary is decoded whole. Stopping
	 *  early (a page filled) reads no further. */
	private *leanEventsNewestFirst(chunkBytes = EVENT_LOG_READ_CHUNK): Generator<TReportEvent> {
		for (let i = this.diskBuffer.length - 1; i >= 0; i--) yield JSON.parse(this.diskBuffer[i]) as TReportEvent;
		if (!this.eventLogPath || !existsSync(this.eventLogPath)) return;
		const fd = openSync(this.eventLogPath, "r");
		try {
			let position = fstatSync(fd).size;
			let carry = Buffer.alloc(0); // the start of a line whose end was in the chunk read before this one
			while (position > 0) {
				const length = Math.min(chunkBytes, position);
				position -= length;
				const chunk = Buffer.alloc(length);
				readSync(fd, chunk, 0, length, position);
				const joined = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk;
				const firstNewline = joined.indexOf(0x0a);
				if (firstNewline === -1) {
					carry = joined;
					continue;
				}
				carry = joined.subarray(0, firstNewline);
				const lines = joined.toString("utf8", firstNewline + 1).split("\n");
				for (let i = lines.length - 1; i >= 0; i--) if (lines[i]) yield JSON.parse(lines[i]) as TReportEvent;
			}
			const first = carry.toString("utf8");
			if (first) yield JSON.parse(first) as TReportEvent;
		} finally {
			closeSync(fd);
		}
	}

	/** The FULL run history (every lean event) — the report's event source, never truncated by the window. Flushed disk
	 *  lines plus any still-buffered lines, so the report holds every event even when the log was never flushed to disk
	 *  (a write with no per-run log path, or fewer than one batch emitted). */
	private readEventLog(): TReportEvent[] {
		this.flushEventLog(); // when a log path is set this drains the buffer to disk; otherwise the buffer is read below
		const lines: string[] = [];
		if (this.eventLogPath && existsSync(this.eventLogPath)) lines.push(...readFileSync(this.eventLogPath, "utf8").split("\n").filter(Boolean));
		lines.push(...this.diskBuffer);
		return lines.map((line) => JSON.parse(line) as TReportEvent);
	}

	private async writeStandaloneReport({ fixedPath, compressed }: { fixedPath?: string; compressed: boolean }): Promise<string> {
		const rpcCache = (this.getWorld().runtime[RPC_CACHE] ?? {}) as Record<string, unknown>;
		// Ensure essential data is always available offline:
		// 1. Events — embed one complete end-of-run copy under the bare key; drop the per-filter copies the live run
		//    cached (getCachedResponse serves the bare copy for any filter; the views filter themselves).
		for (const key of Object.keys(rpcCache)) if (key.startsWith(`${GET_EVENTS_METHOD}:`)) delete rpcCache[key];
		// The report embeds the FULL run history from the on-disk log — every event, never truncated by the in-memory
		// window, already report-lean (slimmed at write). The in-memory `events` buffer is only the live-backfill window.
		const reportEvents = this.readEventLog();
		rpcCache[GET_EVENTS_METHOD] = { events: reportEvents };
		// 2. Parameterless steps with view products (deterministic view toggles). Exclude getClusteredQuads: it's the graph
		//    DATA RPC, not a view toggle (no `.view` product), it requires an accessLevel by design (no default — it honors
		//    the caller's access exactly), and it's serialized canonically below via buildGraphSource. Running it here arg-less
		//    only threw on the missing accessLevel; its bare-key entry is written after this loop, so the early-cache guard misses it.
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
					logger.warn(`[shu writeStandaloneReport] step ${name} failed: ${errorDetail(err)}`);
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
			const refreshable = ["showAffordances"];
			for (const name of refreshable) {
				const step = stepper.steps?.[name];
				if (!step || typeof (step as { action?: unknown }).action !== "function") continue;
				const key = `${stepper.constructor.name}-${name}`;
				try {
					const r = (await (step as { action: (a: Record<string, unknown>) => unknown }).action({})) as { products?: Record<string, unknown> } | undefined;
					if (r?.products) rpcCache[key] = r.products;
				} catch (err) {
					logger.warn(`[shu writeStandaloneReport] ${key} refresh failed: ${errorDetail(err)}`);
				}
			}
		}
		// Serialize the FULL graph as ONE canonical getClusteredQuads response, exactly like the live RPC — the offline overview
		// and sequence views paint client-side from this quad set and hide instrumentation by default themselves (toggleable),
		// so there is no server-rendered image to embed and the offline filter behaves identically to live.
		const built = await buildGraphSource(this.getWorld());
		// Drop the live run's many per-params getClusteredQuads copies; offline serves only this canonical snapshot, so every
		// view that reads the snapshot sees the same graph.
		for (const key of Object.keys(rpcCache)) if (key === CLUSTERED_QUADS_METHOD || key.startsWith(`${CLUSTERED_QUADS_METHOD}:`)) delete rpcCache[key];
		if (built) rpcCache[CLUSTERED_QUADS_METHOD] = { quads: built.quads, clusters: built.clusters };
		else logger.warn("[shu writeStandaloneReport] graph snapshot not captured: QuadStore has no getClusteredQuads; the offline graph will be unavailable");
		// Reconstruct view hash from events (view products) and cache (last query label).
		// `view` is the productsDomain key (e.g. "affordances"); pane-state expects the
		// component tag (e.g. "shu-affordances-panel"). Resolve via the registered domain's
		// `ui.component` so the offline file uses the same vocabulary as live runs.
		const domains = this.getWorld().domains;
		const cols: string[] = [];
		let label = "";
		for (const e of reportEvents) {
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
		// No report-time slimming: the disk log is already report-lean by construction (slimmed at write — debug-artifact
		// bulk excluded, stepValuesMap dropped, products reduced to display subfields). The whole payload is compressed below.
		// `events` lives only in the rpcCache (getEvents); hydrateFromDom reads rpcCache + viewHash, never a top-level events field.
		const hydration = JSON.stringify({ rpcCache, viewHash });
		const scripts = inlineScriptsForView(this.getWorld().domains, new Set(cols));
		let payload = JSON.stringify({ bundle: loadReportBundle(), hydration, scripts });
		const secrets = await this.getWorld().shared.getSecrets();
		for (const [, value] of Object.entries(secrets)) if (value) payload = payload.replaceAll(value, OBSCURED_VALUE);
		const html = buildReportHtml(".", payload, compressed);
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
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: true });
				return actionOKWithProducts({ path: written });
			},
		},
		savesShuUncompressedTo: {
			gwta: "saves shu uncompressed to {where: string}",
			description:
				"Write the standalone shu report with an uncompressed plain-JSON payload, so the redacted text can be read and audited directly — same content as the compressed report, just larger. A one-off write that does not become the feature's canonical output.",
			action: async ({ where }: { where: string }) => {
				const written = await this.writeStandaloneReport({ fixedPath: where, compressed: false });
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
		showDocument: {
			gwta: "show document",
			productsDomain: "shu-document-column",
			action: () => actionOKWithProducts({}),
		},
		getEvents: {
			gwta: `get monitor events {filter: ${DOMAIN_EVENTS_FILTER}}`,
			productsSchema: MonitorEventsSchema,
			// The events are the RPC response that fills the client's backfill; keeping them on this event too re-embeds the whole log, recursively.
			retainProducts: false,
			action: ({ filter }: { filter: TEventsFilter }) => {
				const { level, kind, since, until, limit, seqPath, minLevel, offset } = filter;
				const cap = limit && limit > 0 ? Math.min(limit, EVENTS_COUNT_CAP) : EVENTS_COUNT_CAP;
				const floor = minLevel ? HAIBUN_LOG_LEVELS.indexOf(minLevel) : 0;
				const run = this.runId;
				// A step's own events: its lifecycle events carry its seqPath as their id (written bracketed), and its dispatch trace is named for it.
				const ofStep = (e: THaibunEvent, step: string): boolean => e.id === `dispatch.${step}` || parseSeqPath(e.id)?.join(".") === step;
				const wanted = (e: THaibunEvent): boolean =>
					(!run || (e as Record<string, unknown>).run === run) && // the run being recorded; a stayed instance's buffer may still hold the last one's tail
					(!level || e.level === level) &&
					(!kind || e.kind === kind) &&
					(!since || e.timestamp >= since) &&
					(!until || e.timestamp <= until) &&
					(!seqPath || ofStep(e, seqPath)) &&
					(floor === 0 || HAIBUN_LOG_LEVELS.indexOf(e.level) >= floor);
				// The live buffer holds only the newest maxEvents; the run's disk log (the report's source) holds every
				// event. A page that reaches at or past the buffer's oldest event is served from the log, read backward
				// from its end a chunk at a time, so a page over a log of any size costs a chunk and the page. And a page
				// over a trimmed buffer reports truncated even when it fits the budget. Together these let a client paging
				// backward (fetchRange) reach the start of the run instead of stopping where the buffer was trimmed. The
				// log's lean events are these same events slimmed for the report; every field the filters and the
				// document read (id, timestamp, kind, stage, level) survives the slimming. `total` is the count matching
				// the filter; a page from the log does not scan the whole log to count, so it carries none.
				const oldestHeld = this.events[0]?.timestamp;
				const at = minLevel ?? HAIBUN_LOG_LEVELS[0];
				const total = this.levelCounts[at] ?? 0;
				const first = this.firstLoggedAt;
				// A page by index: the events whose index at `minLevel` is in [offset, offset + limit), oldest first. From the
				// buffer when the buffer holds them; else from the log, read forward from the batch they begin in.
				if (offset !== undefined) {
					const end = Math.min(total, offset + cap);
					const inRange = (e: { idx?: Record<string, number> }): boolean => e.idx?.[at] !== undefined && e.idx[at] >= offset && e.idx[at] < end;
					const oldestBufferedIdx = (this.events.find((e) => (e as { idx?: Record<string, number> }).idx?.[at] !== undefined) as { idx?: Record<string, number> } | undefined)?.idx?.[at];
					let page: Record<string, unknown>[];
					if (oldestBufferedIdx !== undefined && offset >= oldestBufferedIdx) page = this.events.filter((e) => inRange(e as { idx?: Record<string, number> }) && wanted(e)).map(slimLiveEvent);
					else {
						page = [];
						for (const e of this.leanEventsFromIndex(at, offset)) {
							const i = (e as { idx?: Record<string, number> }).idx?.[at];
							if (i === undefined || i < offset) continue;
							if (i >= end) break;
							if (wanted(e as unknown as THaibunEvent)) page.push(slimLiveEvent(e as unknown as THaibunEvent));
						}
					}
					return actionOKWithProducts({ events: page, total, first, run });
				}
				// One step's events are few and asked for by name: what the buffer holds of them, completed from the run's log
				// when the buffer does not hold the run from its start (it was trimmed, or this process did not record it).
				if (seqPath !== undefined) {
					const held = this.events.filter(wanted).map(slimLiveEvent);
					if (held.length >= cap || (!this.eventsTrimmed && oldestHeld !== undefined)) return actionOKWithProducts({ events: held.slice(-cap), total, first, run });
					const ids = new Set(held.map((e) => `${e.id}:${e.stage ?? ""}`));
					const older: Record<string, unknown>[] = [];
					for (const e of this.leanEventsNewestFirst() as Iterable<THaibunEvent>) {
						if (older.length + held.length >= cap) break;
						if (wanted(e) && !ids.has(`${e.id}:${(e as { stage?: string }).stage ?? ""}`)) older.push(slimLiveEvent(e));
					}
					return actionOKWithProducts({ events: [...older.reverse(), ...held], total, first, run });
				}
				if (this.eventsTrimmed && until !== undefined && (oldestHeld === undefined || until <= oldestHeld)) {
					const fromLog = this.leanEventsNewestFirst() as Iterable<THaibunEvent>;
					return actionOKWithProducts({ ...takeRecentWithinBudget(filterIterable(fromLog, wanted), cap, EVENTS_BYTE_BUDGET), total, first, run });
				}
				const filtered = this.events.filter(wanted);
				const { events, truncated } = recentEventsWithinBudget(filtered, cap, EVENTS_BYTE_BUDGET);
				const headTrimmed = this.eventsTrimmed && (!since || oldestHeld === undefined || since < oldestHeld);
				// A page the buffer cannot fill at these levels (its newest events at them are fewer than asked, because what is
				// older was trimmed to the log) is completed from the log, with what is older than the buffer holds: a short
				// page must mean the run has no more, never that the buffer has no more.
				if (events.length < cap && headTrimmed && oldestHeld !== undefined) {
					const olderThanBuffer = (e: THaibunEvent): boolean => wanted(e) && e.timestamp < oldestHeld;
					const older = takeRecentWithinBudget(filterIterable(this.leanEventsNewestFirst() as Iterable<THaibunEvent>, olderThanBuffer), cap - events.length, EVENTS_BYTE_BUDGET);
					return actionOKWithProducts({ events: [...older.events, ...events], truncated: truncated || older.truncated, total, first, run });
				}
				return actionOKWithProducts({ events, total, first, run, truncated: truncated || headTrimmed });
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
		recordClientBlips: {
			gwta: `record client blips {batch: ${DOMAIN_CLIENT_BLIPS}}`,
			description: "Receive a batch of fine-grained occurrences the SPA recorded and put each into the run's blip channel, in the order the browser recorded them.",
			action: ({ batch }: { batch: TClientBlips }) => {
				const world = this.getWorld();
				for (const blip of batch.blips) recordBlip(world, blip.name, blip.value, { ...blip.attributes, at: blip.at });
				// A browser buffer that overflowed between batches would otherwise be invisible: the run holds what it was
				// given, and the page holds the truth about what it saw.
				const missed = (batch.recorded ?? 0) - (this.clientBlipsReceived += batch.blips.length);
				if (missed > 0) world.eventLogger.debug(`[shu] ${missed} client occurrence(s) recorded but not delivered; the page's buffer filled between batches`);
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
		getClusteredQuads: {
			gwta: "get clustered quads",
			productsSchema: ClusteredQuadsSchema,
			// The sampled graph is the RPC response; keeping it on the event too holds a second copy of it per call.
			retainProducts: false,
			action: async (args: { perTypeLimit?: number | string; types?: string[] | string; accessLevel?: string; scope?: string } = {}) => {
				const store = this.getWorld().shared.getStore();
				// RPC params arrive stringified through the synthetic-step plumbing; coerce both back to native shapes.
				const limitNum = typeof args.perTypeLimit === "string" ? Number(args.perTypeLimit) : args.perTypeLimit;
				const perTypeLimit = Math.max(1, Math.min(10000, Number.isFinite(limitNum) ? (limitNum as number) : 100));
				// Required, same as the dereference/query paths — no default ceiling, so the cluster view honors the caller's
				// access exactly. A caller states a QUERY level: `all` asks for everything it may see, and refusing it left
				// the graph view with only the quads that happened to stream live.
				const accessLevel = storeScopeFor(AccessQueryLevelSchema.parse(args.accessLevel));
				// A federated read asks for "own" — the peer's authoritative data, never its view of the world (see TClusteredQuadsOpts).
				if (args.scope !== undefined && args.scope !== "own" && args.scope !== "federated")
					return actionNotOK(`getClusteredQuads: scope must be "own" or "federated", got "${args.scope}"`);
				const scope = args.scope as "own" | "federated" | undefined;
				let types: string[] | undefined;
				if (Array.isArray(args.types)) types = args.types;
				else if (typeof args.types === "string" && args.types.length > 0) {
					try {
						const parsed: unknown = JSON.parse(args.types);
						if (Array.isArray(parsed)) types = parsed.map(String);
					} catch (err) {
						this.getWorld().eventLogger.warn(`getClusteredQuads: ignoring non-JSON 'types' param: ${errorDetail(err)}`);
					}
				}
				if (!store.getClusteredQuads) {
					return actionNotOK("QuadStore does not support getClusteredQuads");
				}
				const result = await store.getClusteredQuads({ perTypeLimit, types, accessLevel, scope });
				// The store sample is canonical; the live observation buffer only EXTENDS it through the one shared,
				// budget-bounded merge (dedup by fact, admit-or-omit per type, relabel newcomers). Concatenating the
				// buffer unbudgeted let every observed subject past the requested limit — the client seeds this
				// response verbatim, so the response itself must hold the bound.
				const model = new QuadGraphModel(
					perTypeLimit,
					(type) => this.resourceRels().fields(type),
					(type) => this.resourceRels().displayLabelRel(type),
				);
				model.seed({ quads: result.quads as TQuad[], clusters: [...result.clusters] });
				model.merge(types?.length ? this.observationQuads.filter((q) => types.includes(q.namedGraph)) : this.observationQuads);
				const quads = model.snapshot.quads.map(({ subject, predicate, object, objectType, namedGraph, timestamp, properties }) => ({
					subject,
					predicate,
					object,
					objectType,
					namedGraph,
					timestamp,
					properties,
				}));
				// Include the schema (Class + Property + rdf:type edges) in the SAME response, pruned to the terms the data
				// uses. Evidence is the observation buffer UNION the response's own quads: the buffer covers what a
				// types-narrowed request omits, and the store-backed response covers types whose observations the bounded
				// buffer has evicted — either alone under-reports, so a type created early or fetched narrowly would drop
				// from the schema. The offline report assembles it the same way (buildGraphSource).
				const standardVocab = await enumerateStandardVocab(this.getWorld().domains);
				const withSchema = withOntologySchema({ quads, clusters: model.snapshot.clusters }, [...this.observationQuads, ...quads], this.getWorld().domains, standardVocab);
				return actionOKWithProducts({ ...withSchema, site: activeSitePrincipal(this.getWorld()) });
			},
		},
		clusteredGraphHoldsFromSite: {
			gwta: "clustered graph holds {type} {subject} from site {site}",
			productsSchema: z.object({ subject: z.string(), site: z.string() }),
			// Federation-health inspection: does this instance's merged view hold {subject} (a {type} individual)
			// SERVED BY {site}? Reads the same clustered surface the views render from, so it asserts exactly what a
			// user would see — including that the subject's stamp names the site that actually serves it.
			action: async ({ type, subject, site }: { type: string; subject: string; site: string }) => {
				const store = this.getWorld().shared.getStore();
				if (!store.getClusteredQuads) return actionNotOK("QuadStore does not support getClusteredQuads");
				const { clusters } = await store.getClusteredQuads({ perTypeLimit: 1000, accessLevel: Access.private });
				const cluster = clusters.find((c) => c.type === type);
				if (!cluster?.sampledSubjects.includes(subject)) return actionNotOK(`clustered graph holds no ${type} ${subject}`);
				const served = cluster.sites?.[subject];
				return served === site ? actionOKWithProducts({ subject, site }) : actionNotOK(`${subject} is served by ${served ?? "this site (unstamped)"}, not ${site}`);
			},
		},
		federateGraphReads: {
			gwta: "federate graph reads from {where}",
			productsSchema: z.object({ site: z.string() }),
			// Reads-first federation: merge a peer instance's clustered graph reads into this one's view, each of the
			// peer's subjects stamped with its site principal so the view can group by site. Site principals must be
			// unique in a federation — when this instance still carries the default (did:site:0 to itself) and collides
			// with the peer, it asks the peer what it should be called and adopts the answer; an operator-set principal
			// that collides is a configuration error, surfaced as one.
			action: async ({ where }: { where: string }) => {
				const world = this.getWorld();
				const source = new RemoteGraphSource({ url: where });
				const peer = await source.connect();
				if (peer === activeSitePrincipal(world)) {
					if (!hasDefaultSitePrincipal(world)) return actionNotOK(`federate: site principals collide (${peer}) and this site is operator-named — set HAIBUN_SITE_KEY uniquely`);
					const assigned = await source.requestName();
					adoptSitePrincipal(world, assigned);
					await persistPrincipalIndividual(world, { id: assigned, controller: assigned, generatedAtTime: new Date().toISOString() });
				}
				const store = world.shared.getStore();
				if (!(store instanceof QuadStore)) return actionNotOK("federate: the world store does not support federation");
				store.federate(source);
				return actionOKWithProducts({ site: peer });
			},
		},
		graphQuery: {
			gwta: `graph query {query: ${DOMAIN_GRAPH_QUERY}}`,
			fallback: true,
			productsSchema: GraphQueryResultSchema,
			// The vertex rows are the RPC response; keeping them on the event too is the per-query bloat.
			retainProducts: false,
			action: async ({ query }: { query: TGraphQuery }) => {
				const store = this.getWorld().shared.getStore();
				const { label, limit, offset } = query;
				if (!label) return actionNotOK("graphQuery requires a label; the inherent quad store reads one type at a time");
				if (query.textQuery) return actionNotOK("graphQuery (inherent quad store) supports label + equality filters only; textQuery needs a query-capable store");
				const filters: Record<string, unknown> = {};
				for (const f of query.filters) filters[f.predicate] = f.value; // equality only: queryIndividuals matches predicate→value; richer operators need a query-capable store
				const hasFilters = Object.keys(filters).length > 0;
				const vertices = await store.queryIndividuals(label, hasFilters ? filters : undefined, { limit, offset });
				return actionOKWithProducts({ vertices, total: vertices.length });
			},
		},
	} satisfies TStepperSteps;
}
