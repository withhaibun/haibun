/**
 * IndexedDbEventStore — the client-side persistence behind the run sources (event-source), the events analogue of
 * quad-store-idb: the bulk lives here, off the JS heap, and survives a reload. Events are stored lean, keyed by their time
 * and identity, indexed by their index at each level so a page of the run is one ranged read, and the store keeps beside
 * them each run's extent per level, so a tab with no server still spans the run it last held.
 *
 * Degrades by design: without IndexedDB (a standalone report, a context without it) every read returns empty and every
 * write is a no-op, so the log falls back to the server exactly as before. Browser-only (IndexedDB is absent in
 * jsdom/node) → exercised by the e2e suites; the log's logic is unit-tested against the `EventStore` contract with an
 * in-memory stand-in. No dependency: raw IndexedDB, promisified.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";

export type TStoredEvent = Record<string, unknown>;

/** What the shared log asks of its persistence, every question scoped to ONE RUN (the `run` the server stamps on its
 *  events and answers; "" for a server that names none): a device keeps every run it has seen, and a view shows one. One
 *  implementation over IndexedDB; tests use an in-memory one. */
export interface EventStore {
	/** Persist events (idempotent by key; a re-put of the same event is a no-op). Each carries its run. */
	putMany(events: readonly TStoredEvent[]): Promise<void>;
	/** The events of `run` whose index at `level` is in [start, end), in index order — ALL of them, or none: a page served
	 *  from the device is a page the device holds completely, never a page with rows missing in it. */
	pageAt(run: string, level: string, start: number, end: number): Promise<TStoredEvent[]>;
	/** The run's extent at a level as last known (how many events it holds there, and when it began), for a tab with no
	 *  server to span its rail by. */
	extent(run: string, level: string): Promise<{ total: number; first?: number; last?: number } | undefined>;
	setExtent(run: string, level: string, extent: { total: number; first?: number; last?: number }): Promise<void>;
	/** The run last seen from the server, so a tab with no server reads the run it last held rather than none. */
	lastRun(): Promise<string | undefined>;
	setLastRun(run: string): Promise<void>;
	/** Forget everything. */
	clear(): Promise<void>;
}

/** The run an event belongs to, as the server stamped it; "" for a server that names none (one run, then). */
export const runOf = (e: TStoredEvent): string => (typeof e.run === "string" ? e.run : "");

const DB_NAME = "shu-events";
/** Bumped when what is stored changes shape or meaning; an upgrade starts the store afresh (the server has the run). */
const VERSION = 7;
const EVENTS = "events";
const META = "meta";
/** One index per level over [run, the event's index at that level] (`idx.<level>`, stamped by the server); an event that
 *  does not count toward a level is simply absent from that level's index. */
const idxIndexName = (level: string): string => `by-run-idx-${level}`;
const EXTENT_KEY = (run: string, level: string): string => `extent:${run}:${level}`;
const LAST_RUN_KEY = "lastRun";

/** An event's storage key: its time first, so two runs' events (whose ids repeat: every run has a step 0.1) never collide,
 *  then its identity, so a step's start and end (which share an id) are two rows. */
export const eventTime = (e: Record<string, unknown>): number => Number(e.timestamp) || 0;
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
			for (const level of HAIBUN_LOG_LEVELS) events.createIndex(idxIndexName(level), ["__run", `idx.${level}`], { unique: false });
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
			for (const e of events) store.put({ ...e, __key: storedEventKey(e), __run: runOf(e) });
		});
	}

	async pageAt(run: string, level: string, start: number, end: number): Promise<TStoredEvent[]> {
		if (end <= start) return [];
		const rows = await withStores("readonly", [EVENTS], async (tx) => {
			const index = tx.objectStore(EVENTS).index(idxIndexName(level));
			const range = IDBKeyRange.bound([run, start], [run, end - 1]);
			const held = await done(index.count(range));
			if (held < end - start) return []; // not all of it: none of it, so the server is asked for the page whole
			return ((await done(index.getAll(range))) as Array<TStoredEvent & { __key: string; __run: string }>).map(({ __key, __run, ...event }) => event);
		});
		return rows ?? [];
	}

	async extent(run: string, level: string): Promise<{ total: number; first?: number; last?: number } | undefined> {
		const found = await withStores("readonly", [META], (tx) => done(tx.objectStore(META).get(EXTENT_KEY(run, level))));
		return found && typeof found === "object" ? (found as { total: number; first?: number; last?: number }) : undefined;
	}

	async setExtent(run: string, level: string, extent: { total: number; first?: number; last?: number }): Promise<void> {
		await withStores("readwrite", [META], (tx) => {
			tx.objectStore(META).put(extent, EXTENT_KEY(run, level));
		});
	}

	async lastRun(): Promise<string | undefined> {
		const found = await withStores("readonly", [META], (tx) => done(tx.objectStore(META).get(LAST_RUN_KEY)));
		return typeof found === "string" ? found : undefined;
	}

	async setLastRun(run: string): Promise<void> {
		await withStores("readwrite", [META], (tx) => {
			tx.objectStore(META).put(run, LAST_RUN_KEY);
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
	#extents = new Map<string, { total: number; first?: number; last?: number }>();
	putMany(events: readonly TStoredEvent[]): Promise<void> {
		for (const e of events) this.#events.set(storedEventKey(e), e);
		return Promise.resolve();
	}
	pageAt(run: string, level: string, start: number, end: number): Promise<TStoredEvent[]> {
		const rows = [...this.#events.values()].filter((e) => {
			const i = (e.idx as Record<string, number> | undefined)?.[level];
			return runOf(e) === run && i !== undefined && i >= start && i < end;
		});
		if (rows.length < end - start) return Promise.resolve([]);
		rows.sort((a, b) => ((a.idx as Record<string, number>)[level] ?? 0) - ((b.idx as Record<string, number>)[level] ?? 0));
		return Promise.resolve(rows);
	}
	extent(run: string, level: string): Promise<{ total: number; first?: number; last?: number } | undefined> {
		return Promise.resolve(this.#extents.get(`${run}:${level}`));
	}
	setExtent(run: string, level: string, extent: { total: number; first?: number; last?: number }): Promise<void> {
		this.#extents.set(`${run}:${level}`, extent);
		return Promise.resolve();
	}
	#lastRun: string | undefined;
	lastRun(): Promise<string | undefined> {
		return Promise.resolve(this.#lastRun);
	}
	setLastRun(run: string): Promise<void> {
		this.#lastRun = run;
		return Promise.resolve();
	}
	clear(): Promise<void> {
		this.#events.clear();
		this.#extents.clear();
		this.#lastRun = undefined;
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
