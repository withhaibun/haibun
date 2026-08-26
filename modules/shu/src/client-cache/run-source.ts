/**
 * The run as a view at one level reads it: a WindowedSource over EVERY event at that level and up, spanning the whole
 * run, paged by index. `count()` is the run's extent (from the server, then grown by live events); `rowAt(i)` is the
 * event at index i when its page is cached; `ensureRange` pages a region in — from the device's store when it caches
 * the page whole, else from the server, which pages its buffer and its disk log by index — and the cached pages are
 * bounded, so memory stays flat however long the run. Live events carry their index at each level (the server stamps
 * it), so each one takes its place exactly, and a missed one leaves a gap that the next ensureRange fills. One source
 * per level, shared by every view at that level, pinned on globalThis like the other shared caches. This is THE event
 * path of the page: a view about one step requests that step's own events by its seqPath, and nothing else caches events.
 *
 * This is the source every rail spans: dragging anywhere in the run pages that region in. The monitor reads it a row per
 * event; the document reads the same source and builds its blocks a page at a time from the events it caches.
 */
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "../hypermedia.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { GET_EVENTS_METHOD } from "../rpc-cache.js";
import { lazyWindowedSource, type WindowedSource } from "../windowed-source.js";
import { getWindowSize } from "../window-size-setting.js";
import { IndexedDbDeviceStore, runOf, type DeviceStore } from "./device-store.js";
import type { Range } from "../ranges.js";

export type TEventRecord = Record<string, unknown>;

/** The message shown when history is not available: not cached on this device, and the server did not respond. */
export const EVENTS_UNAVAILABLE = "Earlier events are not cached on this device, and the server could not be reached to load them.";

/** An event as the device caches it: what the run's report caches of it. Inline artifact content (an image's bytes) and
 *  the step's value map are the bulk of a live event and are never read back from the store — the artifact is fetched
 *  by its path, the values by the step — so they are not written to it; products keep only their display fields. A
 *  store of raw live events was read at a hundred milliseconds a row, and a page of five hundred never returned. */
export function leanForStore(e: TEventRecord): TEventRecord {
	const { content: _content, stepValuesMap: _values, ...rest } = e as TEventRecord & { content?: unknown; stepValuesMap?: unknown };
	const products = rest.products as Record<string, unknown> | undefined;
	if (products && typeof products === "object") {
		const cached: Record<string, unknown> = {};
		for (const f of ["view", "_component", "_type", "_summary"]) if (products[f] !== undefined) cached[f] = products[f];
		rest.products = Object.keys(cached).length > 0 ? cached : undefined;
	}
	return rest;
}

export type TRunExtent = { total: number; first?: number; last?: number };

export interface RunSource extends WindowedSource<TEventRecord> {
	/** The level this source reads at (its events are at this level and up). */
	readonly level: THaibunLogLevel;
	/** The run's extent as known: how many events at this level, when the run began, and the instant of its newest event. */
	extent(): TRunExtent;
	/** The index spans cached, in order: what a view derives its marks and cursor from, never a scan of the extent. */
	cachedRanges(): Range[];
	/** How many events a page caches: a view that derives per page (the document's blocks) aligns to it. */
	readonly pageSize: number;
	/** Whether the extent has been recorded (from the server, or from the device when there is no server). */
	readonly loaded: boolean;
	/** Why a page could not be fetched, or null: not on this device and no server responded. */
	readonly unavailable: string | null;
	/** Learn the extent if not yet known: the first thing a view awaits. */
	ready(): Promise<void>;
}

const SOURCES_KEY = "__SHU_EVENT_RUN_SOURCES__";
const STORE_KEY = "__SHU_EVENT_RUN_STORE__";
type Shared = {
	sources: Map<string, RunSource & { appendLive(events: TEventRecord[]): void; beginRun(): void }>;
	store: DeviceStore;
	unsubscribe?: () => void;
	run?: string;
	/** The run a reader chose, if any: the server naming its own run does not take a reader away from the one they opened. */
	reading?: string;
	switched: Set<() => void>;
	made: Set<(source: RunSource) => void>; // called when a source is made, so a view of the page's caches watches it from then on
};

function shared(): Shared {
	const g = globalThis as unknown as Record<string, Shared | undefined>;
	return (g[SHARED_SLOT] ??= { sources: new Map(), store: new IndexedDbDeviceStore(), made: new Set(), switched: new Set() });
}
const SHARED_SLOT = `${SOURCES_KEY}:${STORE_KEY}`;

/** Install the store the sources persist to (tests: a memory store), dropping any sources built over the previous one. */
export function setDeviceStore(store: DeviceStore): void {
	const s = shared();
	s.store = store;
	s.sources.clear();
}

/** The run sources built so far, in level order: what a view of the page's own caches reads, making none. */
export function runSources(): RunSource[] {
	const s = shared();
	return HAIBUN_LOG_LEVELS.filter((l) => s.sources.has(l)).map((l) => s.sources.get(l) as RunSource);
}

/** Subscribe to each run source as it is made (a view reading a level for the first time). Returns an unsubscribe. */
export function subscribeRunSources(fn: (source: RunSource) => void): () => void {
	const s = shared();
	s.made.add(fn);
	return () => s.made.delete(fn);
}

/** The store the sources persist to: what the device caches of the run, for a view of the page's own caches. */
export function deviceStore(): DeviceStore {
	return shared().store;
}

/** How many runs the device caches: the newest this many, plus the run being read. A device caches every run it has
 *  seen, so this is what bounds it; the client cache view reports the bound and what it forgot. */
export const RUNS_CACHED = 5;

/** Read a run the device caches rather than the one the server is recording: a finished run is not on the server, so its
 *  pages come from the device alone. Reading the run the server names again resumes following it. */
export async function readRun(run: string): Promise<void> {
	const s = shared();
	if (s.run === run) return;
	s.run = run;
	s.reading = run;
	await s.store.setLastRun(run).catch((err) => failFastOrLog("[event-source] last run not persisted:", err));
	for (const src of s.sources.values()) src.beginRun();
	for (const fn of s.switched) fn();
}

/** The run the sources are reading, or undefined before any has been named. */
export function currentRun(): string | undefined {
	return shared().run;
}

/** Be told when the run being read changes, by the server naming a new one or by a reader choosing one. */
export function subscribeRunSwitch(fn: () => void): () => void {
	const s = shared();
	s.switched.add(fn);
	return () => s.switched.delete(fn);
}

/** Forget every run but the newest few and the one being read; reports what it forgot. */
export async function cullCachedRuns(): Promise<string[]> {
	const s = shared();
	return await s.store.cullRuns(RUNS_CACHED, s.run);
}

/** Test-only: forget every source, so the next requests again. */
export function resetRunSources(): void {
	const s = shared();
	s.unsubscribe?.();
	s.unsubscribe = undefined;
	s.sources.clear();
	s.run = undefined;
	s.reading = undefined;
	s.switched.clear();
}

/** The run the sources read: the one the server named on its latest response or event. A different run named later is a
 *  NEW run (a stayed instance run again): every source starts over in it — its pages and extent were another run's. A
 *  server that names no run records one (""). */
function recordRun(s: Shared, run: string | undefined): void {
	if (run === undefined || s.run === run) return;
	if (s.reading !== undefined && s.reading !== run) return; // a reader is reading a run they chose; the server's own run waits
	const switching = s.run !== undefined;
	s.run = run;
	void s.store.setLastRun(run).catch((err) => failFastOrLog("[event-source] last run not persisted:", err));
	if (switching) for (const src of s.sources.values()) src.beginRun();
	for (const fn of s.switched) fn();
	void s.store.cullRuns(RUNS_CACHED, run).catch((err) => failFastOrLog("[event-source] the cached runs were not culled:", err));
}

/** The run to read before any response has named one: the device's last, so a tab with no server reads the run it last cached. */
async function recallLastRun(s: Shared): Promise<string> {
	if (s.run === undefined) {
		try {
			s.run = (await s.store.lastRun()) ?? undefined;
		} catch (err) {
			failFastOrLog("[event-source] reading the last run failed:", err);
		}
	}
	return s.run ?? "";
}

/** When the run the page caches starts and ends, as the run sources know it: the earliest start and the newest event over
 *  every level read. Asks for nothing and caches nothing: a control that only places the cursor in the run (playback, the
 *  actions bar) reads it without paging the run in. Both 0 before any view has read the run. */
export function runSpan(): { first: number; last: number } {
	let first = Number.POSITIVE_INFINITY;
	let last = 0;
	for (const src of shared().sources.values()) {
		const { first: f, last: l } = src.extent();
		if (f !== undefined && f < first) first = f;
		if (l !== undefined && l > last) last = l;
	}
	return Number.isFinite(first) ? { first, last } : { first: 0, last: 0 };
}

/** Whether an instant is the run's live edge: at or past its newest event, as the run sources know it. The ONE rule every
 *  view places the cursor by: a row that is the newest is the live edge, and the cursor there is null (the slider at its
 *  end, every view following), never a cutoff that excludes what comes next. */
export function atLiveEdge(instant: number): boolean {
	const { last } = runSpan();
	return last > 0 && instant >= last;
}

/** The index of an event at `level`, as the server stamped it, or undefined when it does not count at that level. */
const indexAt = (e: TEventRecord, level: string): number | undefined => (e.idx as Record<string, number> | undefined)?.[level];

/** The run source at `level`: one per level for the page, made on first ask. */
export function eventRunSource(level: THaibunLogLevel): RunSource {
	const s = shared();
	const existing = s.sources.get(level);
	if (existing) return existing;
	const source = makeRunSource(level, s);
	s.sources.set(level, source);
	for (const fn of s.made) fn(source);
	// Every live batch reaches every source: each places the events that count at its level. A live event names the run
	// being recorded now; a new name is a new run.
	s.unsubscribe ??= subscribeBatchedEvents({
		onBatch: (events) => {
			for (const e of events) if (typeof e.run === "string") recordRun(s, e.run);
			for (const src of s.sources.values()) src.appendLive(events);
		},
	});
	return source;
}

function makeRunSource(level: THaibunLogLevel, s: Shared): RunSource & { appendLive(events: TEventRecord[]): void; beginRun(): void } {
	const store = s.store;
	let extent: TRunExtent = { total: 0 };
	let loaded = false;
	let unavailable: string | null = null;
	let readying: Promise<void> | null = null;
	const subs = new Set<() => void>();
	const notifyAll = (): void => {
		for (const cb of subs) cb();
	};
	const run = (): string => s.run ?? "";
	/** A run the reader chose is a finished run: the server is recording another one, so only the device has it. */
	const deviceOnly = (): boolean => s.reading !== undefined && s.reading === run();

	type TAnswer = { events?: TEventRecord[]; total?: number; first?: number; run?: string };
	const request = (filter: Record<string, unknown>): Promise<TAnswer> =>
		conduit().follow({ method: GET_EVENTS_METHOD, params: { filter: { minLevel: level, ...filter } } }, `run source at ${level}`);

	/** The newest instant among events, or the one known: the run's end moves only forward. */
	const lastOf = (events: readonly TEventRecord[], known: number | undefined): number | undefined =>
		events.reduce<number | undefined>((acc, e) => (typeof e.timestamp === "number" && (acc === undefined || e.timestamp > acc) ? e.timestamp : acc), known);

	const record = (response: TAnswer): void => {
		recordRun(s, response.run ?? ""); // may begin a new run, which starts this source over before the response is applied
		if ((response.run ?? "") !== run()) return; // another run's response says nothing about the run being read
		if (typeof response.total === "number") extent = { total: Math.max(extent.total, response.total), first: response.first ?? extent.first, last: lastOf(response.events ?? [], extent.last) };
		loaded = true;
		void store.setExtent(run(), level, extent).catch((err) => failFastOrLog("[event-source] extent not persisted:", err));
	};

	const pageSize = getWindowSize();
	const makePages = () =>
		lazyWindowedSource<TEventRecord>({
			count: () => extent.total,
			pageSize,
			fetch: async (start, end) => {
				// The device first: a page it caches completely needs no server. Else the server, and what it sends is cached for next time.
				const stored = await store.pageAt(run(), level, start, end);
				if (stored.length === end - start) {
					extent = { ...extent, last: lastOf(stored, extent.last) }; // a page from the device tells the run's span as well as its rows
					return stored;
				}
				if (deviceOnly()) {
					// The run being read is not the run the server is recording: what the device caches of this page is all there is.
					const cached = await store.rowsAt(run(), level, start, end).catch(() => []);
					if (cached.some((e) => e !== undefined)) return cached as TEventRecord[];
					unavailable = EVENTS_UNAVAILABLE;
					notifyAll();
					throw new Error(`the run being read is not on the server, and this page is not cached: ${level} ${start}..${end}`);
				}
				try {
					const response = await request({ offset: start, limit: end - start });
					record(response);
					unavailable = null;
					const events = response.events ?? [];
					void store.putMany(events.map(leanForStore)).catch((err) => failFastOrLog("[event-source] page not persisted:", err));
					return events;
				} catch (err) {
					// No server: what the device caches of the page is all there is to show, with a hole for each row it lacks, and
					// the view reports that the rest is not available (reported, not thrown). A page the device caches nothing of stays empty.
					unavailable = EVENTS_UNAVAILABLE;
					console.warn(`[event-source] a page at ${level} is unavailable:`, err);
					notifyAll();
					const cached = await store.rowsAt(run(), level, start, end).catch(() => []);
					if (cached.some((e) => e !== undefined)) return cached as TEventRecord[];
					throw err;
				}
			},
		});
	let pages = makePages();
	let unsubscribePages = pages.subscribe(notifyAll);

	/** A new run began: the pages and extent cached were another run's. Start over, and tell the views. */
	const beginRun = (): void => {
		unsubscribePages();
		pages = makePages();
		unsubscribePages = pages.subscribe(notifyAll);
		extent = { total: 0 };
		loaded = false;
		unavailable = null;
		void ready().then(notifyAll);
	};

	const ready = (): Promise<void> => {
		if (loaded) return Promise.resolve();
		if (readying) return readying;
		readying = (async () => {
			await recallLastRun(s);
			if (deviceOnly()) {
				const cached = await store.extent(run(), level).catch(() => undefined);
				if (cached) {
					extent = cached;
					loaded = true;
					unavailable = null;
				} else unavailable = EVENTS_UNAVAILABLE;
				pages.notifyCountChanged();
				return;
			}
			try {
				const response = await request({ limit: 1 }); // the newest event, and with it the run's extent (and which run it is)
				record(response);
				unavailable = null;
				void store.putMany((response.events ?? []).map(leanForStore)).catch((err) => failFastOrLog("[event-source] newest event not persisted:", err));
			} catch (err) {
				// No server: the extent the device last knew of its last run, so the rail still spans the run it caches; else
				// nothing, and said so.
				const cached = await store.extent(run(), level).catch(() => undefined);
				if (cached) {
					extent = cached;
					loaded = true;
				} else unavailable = EVENTS_UNAVAILABLE;
				console.warn(`[event-source] extent at ${level} from the device:`, err);
			}
			pages.notifyCountChanged();
		})().finally(() => {
			readying = null;
		});
		return readying;
	};

	const appendLive = (events: TEventRecord[]): void => {
		let grew = false;
		for (const e of events) {
			if (runOf(e) !== run()) continue; // another run's event is not this run's row
			const i = indexAt(e, level);
			if (i === undefined) continue;
			extent = { ...extent, last: lastOf([e], extent.last) }; // the run's newest instant at this level, whether or not its extent grew
			if (i >= extent.total) {
				extent = { total: i + 1, first: extent.first ?? (Number(e.timestamp) || undefined), last: lastOf([e], extent.last) };
				grew = true;
			}
			pages.append(i, e); // placed when its page is cached up to it; a gap before it is ensureRange's to fill
			void store.putMany([leanForStore(e)]).catch((err) => failFastOrLog("[event-source] live event not persisted:", err));
		}
		if (grew) {
			void store.setExtent(run(), level, extent).catch((err) => failFastOrLog("[event-source] extent not persisted:", err));
			pages.notifyCountChanged();
		}
	};

	const source: RunSource & { appendLive(events: TEventRecord[]): void; beginRun(): void } = {
		level,
		count: () => extent.total,
		rowAt: (i) => pages.rowAt(i),
		ensureRange: (start, end) => pages.ensureRange(start, end),
		subscribe: (cb) => {
			subs.add(cb);
			return () => subs.delete(cb);
		},
		markers: () => pages.markers(),
		cachedRanges: () => pages.cachedRanges(),
		pageSize,
		extent: () => extent,
		get loaded() {
			return loaded;
		},
		get unavailable() {
			return unavailable;
		},
		ready,
		appendLive,
		beginRun,
	};
	return source;
}
