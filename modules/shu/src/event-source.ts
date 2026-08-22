/**
 * The run as a view at one level reads it: a WindowedSource over EVERY event at that level and up, spanning the whole
 * run, paged by index. `count()` is the run's extent (from the server, then grown by live events); `rowAt(i)` is the
 * event at index i when its page is resident; `ensureRange` pages a region in — from the device's store when it holds
 * the page whole, else from the server, which pages its buffer and its disk log by index — and the resident pages are
 * bounded, so memory stays flat however long the run. Live events carry their index at each level (the server stamps
 * it), so each one takes its place exactly, and a missed one leaves a gap that the next ensureRange fills. One source
 * per level, shared by every view at that level, pinned on globalThis like the other shared caches. This is THE event
 * path of the page: a view about one step asks for that step's own events by its seqPath, and nothing else holds events.
 *
 * This is the source every rail spans: dragging anywhere in the run pages that region in. The monitor reads it a row per
 * event; the document reads the same source and builds its blocks a page at a time from the events it holds.
 */
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "./hypermedia.js";
import { subscribeBatchedEvents } from "./event-stream.js";
import { GET_EVENTS_METHOD } from "./rpc-cache.js";
import { lazyWindowedSource, type WindowedSource } from "./windowed-source.js";
import { getWindowSize } from "./components/shu-window-size.js";
import { IndexedDbEventStore, runOf, type EventStore } from "./event-store-idb.js";
import type { Range } from "./ranges.js";

export type TEventRecord = Record<string, unknown>;

/** What a reader is told when history is not to hand: not on this device, and no server answered for it. */
export const EVENTS_UNAVAILABLE = "Earlier events are not cached on this device, and the server could not be reached to load them.";

/** An event as the device keeps it: what the run's report keeps of it. Inline artifact content (an image's bytes) and
 *  the step's value map are the bulk of a live event and are never read back from the store — the artifact is fetched
 *  by its path, the values by the step — so they are not written to it; products keep only their display fields. A
 *  store of raw live events was read at a hundred milliseconds a row, and a page of five hundred never returned. */
export function leanForStore(e: TEventRecord): TEventRecord {
	const { content: _content, stepValuesMap: _values, ...rest } = e as TEventRecord & { content?: unknown; stepValuesMap?: unknown };
	const products = rest.products as Record<string, unknown> | undefined;
	if (products && typeof products === "object") {
		const kept: Record<string, unknown> = {};
		for (const f of ["view", "_component", "_type", "_summary"]) if (products[f] !== undefined) kept[f] = products[f];
		rest.products = Object.keys(kept).length > 0 ? kept : undefined;
	}
	return rest;
}

export type TRunExtent = { total: number; first?: number; last?: number };

export interface RunSource extends WindowedSource<TEventRecord> {
	/** The level this source reads at (its events are at this level and up). */
	readonly level: THaibunLogLevel;
	/** The run's extent as known: how many events at this level, when the run began, and the instant of its newest event. */
	extent(): TRunExtent;
	/** The index spans held resident, in order: what a view derives its marks and cursor from, never a scan of the extent. */
	residentRanges(): Range[];
	/** How many events a page holds: a view that derives per page (the document's blocks) aligns to it. */
	readonly pageSize: number;
	/** Whether the extent has been learnt (from the server, or from the device when there is no server). */
	readonly loaded: boolean;
	/** Why a page could not be fetched, or null: not on this device and no server answered. */
	readonly unavailable: string | null;
	/** Learn the extent if not yet known: the first thing a view awaits. */
	ready(): Promise<void>;
}

const SOURCES_KEY = "__SHU_EVENT_RUN_SOURCES__";
const STORE_KEY = "__SHU_EVENT_RUN_STORE__";
type Shared = { sources: Map<string, RunSource & { appendLive(events: TEventRecord[]): void; beginRun(): void }>; store: EventStore; unsubscribe?: () => void; run?: string };

function shared(): Shared {
	const g = globalThis as unknown as Record<string, Shared | undefined>;
	return (g[SHARED_SLOT] ??= { sources: new Map(), store: new IndexedDbEventStore() });
}
const SHARED_SLOT = `${SOURCES_KEY}:${STORE_KEY}`;

/** Install the store the sources persist to (tests: a memory store), dropping any sources built over the previous one. */
export function setRunSourceStore(store: EventStore): void {
	const s = shared();
	s.store = store;
	s.sources.clear();
}

/** Test-only: forget every source, so the next asks again. */
export function resetRunSources(): void {
	const s = shared();
	s.unsubscribe?.();
	s.unsubscribe = undefined;
	s.sources.clear();
	s.run = undefined;
}

/** The run the sources read: the one the server named on its latest answer or event. A different run named later is a
 *  NEW run (a stayed instance run again): every source starts over in it — its pages and extent were another run's. A
 *  server that names no run records one (""). */
function learnRun(s: Shared, run: string | undefined): void {
	if (run === undefined || s.run === run) return;
	const switching = s.run !== undefined;
	s.run = run;
	void s.store.setLastRun(run).catch((err) => failFastOrLog("[event-source] last run not persisted:", err));
	if (switching) for (const src of s.sources.values()) src.beginRun();
}

/** The run to read before any answer has named one: the device's last, so a tab with no server reads the run it last held. */
async function recallRun(s: Shared): Promise<string> {
	if (s.run === undefined) {
		try {
			s.run = (await s.store.lastRun()) ?? undefined;
		} catch (err) {
			failFastOrLog("[event-source] reading the last run failed:", err);
		}
	}
	return s.run ?? "";
}

/** When the run the page holds starts and ends, as the run sources know it: the earliest start and the newest event over
 *  every level read. Asks for nothing and holds nothing: a control that only places the cursor in the run (playback, the
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
	// Every live batch reaches every source: each places the events that count at its level. A live event names the run
	// being recorded now; a new name is a new run.
	s.unsubscribe ??= subscribeBatchedEvents({
		onBatch: (events) => {
			for (const e of events) if (typeof e.run === "string") learnRun(s, e.run);
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

	type TAnswer = { events?: TEventRecord[]; total?: number; first?: number; run?: string };
	const ask = (filter: Record<string, unknown>): Promise<TAnswer> =>
		conduit().follow({ method: GET_EVENTS_METHOD, params: { filter: { minLevel: level, ...filter } } }, `run source at ${level}`);

	/** The newest instant among events, or the one known: the run's end moves only forward. */
	const lastOf = (events: readonly TEventRecord[], known: number | undefined): number | undefined =>
		events.reduce<number | undefined>((acc, e) => (typeof e.timestamp === "number" && (acc === undefined || e.timestamp > acc) ? e.timestamp : acc), known);

	const learn = (answer: TAnswer): void => {
		learnRun(s, answer.run ?? ""); // may begin a new run, which starts this source over before the answer is applied
		if (typeof answer.total === "number") extent = { total: Math.max(extent.total, answer.total), first: answer.first ?? extent.first, last: lastOf(answer.events ?? [], extent.last) };
		loaded = true;
		void store.setExtent(run(), level, extent).catch((err) => failFastOrLog("[event-source] extent not persisted:", err));
	};

	const pageSize = getWindowSize();
	const makePages = () =>
		lazyWindowedSource<TEventRecord>({
			count: () => extent.total,
			pageSize,
			fetch: async (start, end) => {
				// The device first: a page it holds whole needs no server. Else the server, and what it sends is kept for next time.
				const stored = await store.pageAt(run(), level, start, end);
				if (stored.length === end - start) return stored;
				try {
					const answer = await ask({ offset: start, limit: end - start });
					learn(answer);
					unavailable = null;
					const events = answer.events ?? [];
					void store.putMany(events.map(leanForStore)).catch((err) => failFastOrLog("[event-source] page not persisted:", err));
					return events;
				} catch (err) {
					unavailable = EVENTS_UNAVAILABLE; // told to the reader, not thrown
					console.warn(`[event-source] a page at ${level} is unavailable:`, err);
					notifyAll();
					throw err;
				}
			},
		});
	let pages = makePages();
	let unsubscribePages = pages.subscribe(notifyAll);

	/** A new run began: the pages and extent held were another run's. Start over, and tell the views. */
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
			await recallRun(s);
			try {
				learn(await ask({ limit: 1 })); // the newest event, and with it the run's extent (and which run it is)
				unavailable = null;
			} catch (err) {
				// No server: the extent the device last knew of its last run, so the rail still spans the run it holds; else
				// nothing, and said so.
				const kept = await store.extent(run(), level).catch(() => undefined);
				if (kept) {
					extent = kept;
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
			if (i >= extent.total) {
				extent = { total: i + 1, first: extent.first ?? (Number(e.timestamp) || undefined), last: lastOf([e], extent.last) };
				grew = true;
			}
			pages.append(i, e); // placed when its page is resident up to it; a gap before it is ensureRange's to fill
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
		residentRanges: () => pages.residentRanges(),
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
