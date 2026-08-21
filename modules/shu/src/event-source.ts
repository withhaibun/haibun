/**
 * The run as a view at one level reads it: a WindowedSource over EVERY event at that level and up, spanning the whole
 * run, paged by index. `count()` is the run's extent (from the server, then grown by live events); `rowAt(i)` is the
 * event at index i when its page is resident; `ensureRange` pages a region in — from the device's store when it holds
 * the page whole, else from the server, which pages its buffer and its disk log by index — and the resident pages are
 * bounded, so memory stays flat however long the run. Live events carry their index at each level (the server stamps
 * it), so each one takes its place exactly, and a missed one leaves a gap that the next ensureRange fills. One source
 * per level, shared by every view at that level, pinned on globalThis like the other shared caches.
 *
 * This is the source the rail spans: dragging anywhere in the run pages that region in; the document, a prose view of
 * blocks rather than rows, keeps its time-windowed claim (events-snapshot).
 */
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "./hypermedia.js";
import { subscribeBatchedEvents } from "./event-stream.js";
import { GET_EVENTS_METHOD } from "./rpc-cache.js";
import { lazyWindowedSource, type WindowedSource } from "./windowed-source.js";
import { getWindowSize } from "./components/shu-window-size.js";
import { IndexedDbEventStore, type EventStore } from "./event-store-idb.js";
import { EVENTS_UNAVAILABLE, leanForStore, type TEventRecord } from "./events-snapshot.js";

export type TRunExtent = { total: number; first?: number };

export interface RunSource extends WindowedSource<TEventRecord> {
	/** The level this source reads at (its events are at this level and up). */
	readonly level: THaibunLogLevel;
	/** The run's extent as known: how many events at this level, and when the run began. */
	extent(): TRunExtent;
	/** Whether the extent has been learnt (from the server, or from the device when there is no server). */
	readonly loaded: boolean;
	/** Why a page could not be fetched, or null: not on this device and no server answered. */
	readonly unavailable: string | null;
	/** Learn the extent if not yet known: the first thing a view awaits. */
	ready(): Promise<void>;
}

const SOURCES_KEY = "__SHU_EVENT_RUN_SOURCES__";
const STORE_KEY = "__SHU_EVENT_RUN_STORE__";
type Shared = { sources: Map<string, RunSource>; store: EventStore; unsubscribe?: () => void };

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
}

/** The index of an event at `level`, as the server stamped it, or undefined when it does not count at that level. */
const indexAt = (e: TEventRecord, level: string): number | undefined => (e.idx as Record<string, number> | undefined)?.[level];

/** The run source at `level`: one per level for the page, made on first ask. */
export function eventRunSource(level: THaibunLogLevel): RunSource {
	const s = shared();
	const existing = s.sources.get(level);
	if (existing) return existing;
	const source = makeRunSource(level, s.store);
	s.sources.set(level, source);
	// Every live batch reaches every source: each places the events that count at its level.
	s.unsubscribe ??= subscribeBatchedEvents({ onBatch: (events) => { for (const src of s.sources.values()) (src as RunSource & { appendLive(events: TEventRecord[]): void }).appendLive(events); } });
	return source;
}

function makeRunSource(level: THaibunLogLevel, store: EventStore): RunSource & { appendLive(events: TEventRecord[]): void } {
	let extent: TRunExtent = { total: 0 };
	let loaded = false;
	let unavailable: string | null = null;
	let readying: Promise<void> | null = null;
	const subs = new Set<() => void>();
	const notifyAll = (): void => {
		for (const cb of subs) cb();
	};

	const ask = (filter: Record<string, unknown>): Promise<{ events?: TEventRecord[]; total?: number; first?: number }> =>
		conduit().follow({ method: GET_EVENTS_METHOD, params: { filter: { minLevel: level, ...filter } } }, `run source at ${level}`);

	const learn = (answer: { total?: number; first?: number }): void => {
		if (typeof answer.total === "number") extent = { total: Math.max(extent.total, answer.total), first: answer.first ?? extent.first };
		loaded = true;
		void store.setExtent(level, extent).catch((err) => failFastOrLog("[event-source] extent not persisted:", err));
	};

	const pages = lazyWindowedSource<TEventRecord>({
		count: () => extent.total,
		pageSize: getWindowSize(),
		fetch: async (start, end) => {
			// The device first: a page it holds whole needs no server. Else the server, and what it sends is kept for next time.
			const stored = await store.pageAt(level, start, end);
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

	const ready = (): Promise<void> => {
		if (loaded) return Promise.resolve();
		if (readying) return readying;
		readying = (async () => {
			try {
				learn(await ask({ limit: 1 })); // the newest event, and with it the run's extent
				unavailable = null;
			} catch (err) {
				// No server: the extent the device last knew, so the rail still spans the run it holds; else nothing, and said so.
				const kept = await store.extent(level).catch(() => undefined);
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
			const i = indexAt(e, level);
			if (i === undefined) continue;
			if (i >= extent.total) {
				extent = { total: i + 1, first: extent.first ?? (Number(e.timestamp) || undefined) };
				grew = true;
			}
			pages.append(i, e); // placed when its page is resident up to it; a gap before it is ensureRange's to fill
			void store.putMany([leanForStore(e)]).catch((err) => failFastOrLog("[event-source] live event not persisted:", err));
		}
		if (grew) {
			void store.setExtent(level, extent).catch((err) => failFastOrLog("[event-source] extent not persisted:", err));
			pages.notifyCountChanged();
		}
	};

	const source: RunSource & { appendLive(events: TEventRecord[]): void } = {
		level,
		count: () => extent.total,
		rowAt: (i) => pages.rowAt(i),
		ensureRange: (start, end) => pages.ensureRange(start, end),
		subscribe: (cb) => {
			subs.add(cb);
			const off = pages.subscribe(cb);
			return () => {
				subs.delete(cb);
				off();
			};
		},
		markers: () => pages.markers(),
		extent: () => extent,
		get loaded() {
			return loaded;
		},
		get unavailable() {
			return unavailable;
		},
		ready,
		appendLive,
	};
	return source;
}
