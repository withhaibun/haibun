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

export type TStoredEvent = Record<string, unknown>;

/** What the shared log asks of its persistence. One implementation over IndexedDB; tests use an in-memory one. */
export interface EventStore {
	/** Persist events (idempotent by key; a re-put of the same event is a no-op). */
	putMany(events: readonly TStoredEvent[]): Promise<void>;
	/** The newest `limit` stored events at or before `until` (the whole store's newest when `until` is omitted), oldest-first. */
	newestBefore(until: number | undefined, limit: number): Promise<TStoredEvent[]>;
	/** The spans of time this store holds completely. */
	held(): Promise<Range[]>;
	/** Record the spans this store holds completely. */
	setHeld(ranges: Range[]): Promise<void>;
	/** Forget everything. */
	clear(): Promise<void>;
}

const DB_NAME = "shu-events";
const VERSION = 1;
const EVENTS = "events";
const META = "meta";
const IDX_TIME = "by-time";
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
			const events = req.result.createObjectStore(EVENTS, { keyPath: "__key" });
			events.createIndex(IDX_TIME, "timestamp", { unique: false });
			req.result.createObjectStore(META);
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

	async newestBefore(until: number | undefined, limit: number): Promise<TStoredEvent[]> {
		if (limit <= 0) return [];
		const rows = await withStores("readonly", [EVENTS], (tx) => {
			const range = until === undefined ? null : IDBKeyRange.upperBound(until);
			const out: TStoredEvent[] = [];
			return new Promise<TStoredEvent[]>((resolve, reject) => {
				const req = tx.objectStore(EVENTS).index(IDX_TIME).openCursor(range, "prev"); // newest first
				req.onsuccess = () => {
					const cursor = req.result;
					if (!cursor || out.length >= limit) return resolve(out.reverse());
					const { __key, ...event } = cursor.value as TStoredEvent & { __key: string };
					out.push(event);
					cursor.continue();
				};
				req.onerror = () => reject(req.error);
			});
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
	newestBefore(until: number | undefined, limit: number): Promise<TStoredEvent[]> {
		const keys = [...this.#events.keys()].sort();
		const picked: TStoredEvent[] = [];
		for (let i = keys.length - 1; i >= 0 && picked.length < limit; i--) {
			const e = this.#events.get(keys[i]) as TStoredEvent;
			if (until === undefined || eventTime(e) <= until) picked.push(e);
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
	clear(): Promise<void> {
		this.#events.clear();
		this.#held = [];
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
