/**
 * IndexedDbEventStore — the client-side persistence behind the shared event log (events-snapshot), the events analogue of
 * quad-store-idb: the bulk lives here, off the JS heap, and survives a reload. Events are stored lean, keyed by their time
 * and identity, with an index by time so the newest N before a moment are one cursor walk; and the log keeps beside them
 * the spans of time it knows it holds COMPLETELY (`held`), so a later reader can tell "cached, and all of it" from "some
 * events from around then" — the difference between serving a page from here and asking the server.
 *
 * Degrades by design: without IndexedDB (a standalone report, a context without it) every read returns empty and every
 * write is a no-op, so the log falls back to the server exactly as before. Browser-only (IndexedDB is absent in
 * jsdom/node) → exercised by the e2e suites; the log's logic is unit-tested against the `EventStore` contract with an
 * in-memory stand-in. No dependency: raw IndexedDB, promisified.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import type { Range } from "./ranges.js";
import { eventTime } from "./event-backfill.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";

export type TStoredEvent = Record<string, unknown>;

/** What the shared log asks of its persistence. One implementation over IndexedDB; tests use an in-memory one. */
export interface EventStore {
	/** Persist events (idempotent by key; a re-put of the same event is a no-op). */
	putMany(events: readonly TStoredEvent[]): Promise<void>;
	/** The newest `limit` stored events at or before `until` (the whole store's newest when `until` is omitted), at the given
	 *  levels (all, when omitted), oldest-first. */
	newestBefore(until: number | undefined, limit: number, levels?: readonly string[]): Promise<TStoredEvent[]>;
	/** The spans of time this store holds completely. */
	held(): Promise<Range[]>;
	/** Record the spans this store holds completely. */
	setHeld(ranges: Range[]): Promise<void>;
	/** The events whose index at `level` is in [start, end), in index order — ALL of them, or none: a page served from the
	 *  device is a page the device holds completely, never a page with rows missing in it. */
	pageAt(level: string, start: number, end: number): Promise<TStoredEvent[]>;
	/** The run's extent at each level as last known (how many events it holds there, and when it began), for a tab with
	 *  no server to span its rail by. */
	extent(level: string): Promise<{ total: number; first?: number } | undefined>;
	setExtent(level: string, extent: { total: number; first?: number }): Promise<void>;
	/** Forget everything. */
	clear(): Promise<void>;
}

const DB_NAME = "shu-events";
/** Bumped when what is stored changes shape or meaning; an upgrade starts the store afresh (the server has the run). */
const VERSION = 4;
const EVENTS = "events";
const META = "meta";
const IDX_TIME = "by-time";
const IDX_LEVEL_TIME = "by-level-time";
/** One index per level over the event's index at that level (`idx.<level>`, stamped by the server); an event that does
 *  not count toward a level is simply absent from that level's index. */
const idxIndexName = (level: string): string => `by-idx-${level}`;
const EXTENT_KEY = (level: string): string => `extent:${level}`;
const HELD_KEY = "held";

/** An event's storage key: its time first, so two runs' events (whose ids repeat: every run has a step 0.1) never collide,
 *  then its identity, so a step's start and end (which share an id) are two rows. */
export const storedEventKey = (e: TStoredEvent): string => `${String(eventTime(e)).padStart(15, "0")}|${e.id}|${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null); // no IndexedDB here → reads stub, writes drop, the log falls back to the server
			return;
		}
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name); // a new shape: start afresh
			const events = db.createObjectStore(EVENTS, { keyPath: "__key" });
			events.createIndex(IDX_TIME, "timestamp", { unique: false });
			events.createIndex(IDX_LEVEL_TIME, ["level", "timestamp"], { unique: false });
			for (const level of HAIBUN_LOG_LEVELS) events.createIndex(idxIndexName(level), `idx.${level}`, { unique: false });
			db.createObjectStore(META);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			failFastOrLog("[event-store-idb] open failed; the event log will not persist:", req.error);
			resolve(null);
		};
	});
	return dbPromise;
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** Run `fn` in one transaction over the named stores and resolve once it commits; `undefined` when IndexedDB is unavailable. */
async function withStores<T>(mode: IDBTransactionMode, names: string[], fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T | undefined> {
	const db = await openDb();
	if (!db) return undefined;
	const tx = db.transaction(names, mode);
	const result = await fn(tx);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	return result;
}

export class IndexedDbEventStore implements EventStore {
	async putMany(events: readonly TStoredEvent[]): Promise<void> {
		if (events.length === 0) return;
		await withStores("readwrite", [EVENTS], (tx) => {
			const store = tx.objectStore(EVENTS);
			for (const e of events) store.put({ ...e, __key: storedEventKey(e) });
		});
	}

	async newestBefore(until: number | undefined, limit: number, levels?: readonly string[]): Promise<TStoredEvent[]> {
		if (limit <= 0) return [];
		const rows = await withStores("readonly", [EVENTS], async (tx) => {
			// A few requests, never one per row: per level a key cursor skips to the limit-th newest time in one step (stepping
			// a cursor a row at a time is one main-thread turn per row, and on a page also drawing a 3D scene a page of five
			// hundred took longer than the reader waited); the oldest of those times bounds one getAll over the time index,
			// which is then filtered to the levels and cut to the newest `limit`.
			const store = tx.objectStore(EVENTS);
			const wantedLevels = levels ?? null;
			const oldestOf = (range: IDBKeyRange | null, index: IDBIndex, keyTime: (key: IDBValidKey) => number): Promise<number | null> =>
				new Promise((resolve, reject) => {
					const req = index.openKeyCursor(range, "prev");
					let skipped = false;
					req.onsuccess = () => {
						const cursor = req.result;
						if (!cursor) return resolve(null); // fewer rows than asked at this level: everything of it is wanted
						if (!skipped && limit > 1) {
							skipped = true;
							cursor.advance(limit - 1);
							return;
						}
						resolve(keyTime(cursor.key));
					};
					req.onerror = () => reject(req.error);
				});
			let oldestWanted: number | null = null;
			let unbounded = false;
			if (!wantedLevels) {
				oldestWanted = await oldestOf(until === undefined ? null : IDBKeyRange.upperBound(until), store.index(IDX_TIME), (k) => k as number);
				unbounded = oldestWanted === null;
			} else {
				for (const level of wantedLevels) {
					const range = until === undefined ? IDBKeyRange.bound([level, Number.NEGATIVE_INFINITY], [level, Number.POSITIVE_INFINITY]) : IDBKeyRange.bound([level, Number.NEGATIVE_INFINITY], [level, until]);
					const t = await oldestOf(range, store.index(IDX_LEVEL_TIME), (k) => (k as [string, number])[1]);
					if (t === null) unbounded = true; // this level has fewer than limit: all of it is wanted, so the bound is the others'
					else oldestWanted = oldestWanted === null ? t : Math.min(oldestWanted, t);
				}
			}
			const lower = unbounded || oldestWanted === null ? undefined : oldestWanted;
			const span = lower === undefined ? (until === undefined ? null : IDBKeyRange.upperBound(until)) : until === undefined ? IDBKeyRange.lowerBound(lower) : IDBKeyRange.bound(lower, until);
			const all = (await done(store.index(IDX_TIME).getAll(span))) as Array<TStoredEvent & { __key: string }>;
			const mine = wantedLevels ? all.filter((e) => wantedLevels.includes(String(e.level))) : all;
			return mine.slice(Math.max(0, mine.length - limit)).map(({ __key, ...event }) => event);
		});
		return rows ?? [];
	}

	async held(): Promise<Range[]> {
		const ranges = await withStores("readonly", [META], (tx) => done(tx.objectStore(META).get(HELD_KEY)));
		return Array.isArray(ranges) ? (ranges as Range[]) : [];
	}

	async setHeld(ranges: Range[]): Promise<void> {
		await withStores("readwrite", [META], (tx) => {
			tx.objectStore(META).put(ranges, HELD_KEY);
		});
	}

	async pageAt(level: string, start: number, end: number): Promise<TStoredEvent[]> {
		if (end <= start) return [];
		const rows = await withStores("readonly", [EVENTS], async (tx) => {
			const index = tx.objectStore(EVENTS).index(idxIndexName(level));
			const range = IDBKeyRange.bound(start, end - 1);
			const held = await done(index.count(range));
			if (held < end - start) return []; // not all of it: none of it, so the server is asked for the page whole
			return ((await done(index.getAll(range))) as Array<TStoredEvent & { __key: string }>).map(({ __key, ...event }) => event);
		});
		return rows ?? [];
	}

	async extent(level: string): Promise<{ total: number; first?: number } | undefined> {
		const found = await withStores("readonly", [META], (tx) => done(tx.objectStore(META).get(EXTENT_KEY(level))));
		return found && typeof found === "object" ? (found as { total: number; first?: number }) : undefined;
	}

	async setExtent(level: string, extent: { total: number; first?: number }): Promise<void> {
		await withStores("readwrite", [META], (tx) => {
			tx.objectStore(META).put(extent, EXTENT_KEY(level));
		});
	}

	async clear(): Promise<void> {
		await withStores("readwrite", [EVENTS, META], (tx) => {
			tx.objectStore(EVENTS).clear();
			tx.objectStore(META).clear();
		});
	}
}

/** An `EventStore` over memory: what a context without IndexedDB gets, and what the log's unit tests drive. */
export class MemoryEventStore implements EventStore {
	#events = new Map<string, TStoredEvent>();
	#held: Range[] = [];
	putMany(events: readonly TStoredEvent[]): Promise<void> {
		for (const e of events) this.#events.set(storedEventKey(e), e);
		return Promise.resolve();
	}
	newestBefore(until: number | undefined, limit: number, levels?: readonly string[]): Promise<TStoredEvent[]> {
		const keys = [...this.#events.keys()].sort();
		const picked: TStoredEvent[] = [];
		for (let i = keys.length - 1; i >= 0 && picked.length < limit; i--) {
			const e = this.#events.get(keys[i]) as TStoredEvent;
			if ((until === undefined || eventTime(e) <= until) && (!levels || levels.includes(String(e.level)))) picked.push(e);
		}
		return Promise.resolve(picked.reverse());
	}
	held(): Promise<Range[]> {
		return Promise.resolve(this.#held);
	}
	setHeld(ranges: Range[]): Promise<void> {
		this.#held = ranges;
		return Promise.resolve();
	}
	pageAt(level: string, start: number, end: number): Promise<TStoredEvent[]> {
		const rows = [...this.#events.values()].filter((e) => {
			const i = (e.idx as Record<string, number> | undefined)?.[level];
			return i !== undefined && i >= start && i < end;
		});
		if (rows.length < end - start) return Promise.resolve([]);
		rows.sort((a, b) => ((a.idx as Record<string, number>)[level] ?? 0) - ((b.idx as Record<string, number>)[level] ?? 0));
		return Promise.resolve(rows);
	}
	#extents = new Map<string, { total: number; first?: number }>();
	extent(level: string): Promise<{ total: number; first?: number } | undefined> {
		return Promise.resolve(this.#extents.get(level));
	}
	setExtent(level: string, extent: { total: number; first?: number }): Promise<void> {
		this.#extents.set(level, extent);
		return Promise.resolve();
	}
	clear(): Promise<void> {
		this.#events.clear();
		this.#held = [];
		this.#extents.clear();
		return Promise.resolve();
	}
	/** Test reading: how many events are stored. */
	get size(): number {
		return this.#events.size;
	}
}

/** Test/reset hook — drop the cached DB handle so a fresh open happens next. */
export function resetEventStoreIdb(): void {
	dbPromise = null;
}
