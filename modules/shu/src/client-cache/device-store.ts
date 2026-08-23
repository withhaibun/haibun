/**
 * The device's store — the client cache's persistence, the events analogue of quad-store-idb: the bulk lives here, off
 * the JS heap, and survives a reload. Events are stored lean, keyed by their time and identity, indexed by their index
 * at each level so a page of the run is one ranged read; beside them each run's extent per level, the run last seen,
 * and the server's registry (the step list with its concerns and domains), so a tab with no server still spans the run it
 * last cached and still knows the server's declarations.
 *
 * Degrades by design: without IndexedDB (a standalone report, a context without it) every read returns empty and every
 * write is a no-op, so the log falls back to the server exactly as before. Browser-only (IndexedDB is absent in
 * jsdom/node) → exercised by the e2e suites; the log's logic is unit-tested against the `DeviceStore` contract with an
 * in-memory stand-in. No dependency: raw IndexedDB, promisified.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";

export type TStoredEvent = Record<string, unknown>;

/** The site's registry as the device caches it: the step list response (steps, concerns, domains), and when it was cached. */
export type TStoredRegistry = { savedAt: number; response: unknown };

/** What the client cache requests of the device, every question about events scoped to ONE RUN (the `run` the server stamps
 *  on its events and responses; "" for a server that names none): a device caches every run it has seen, and a view shows
 *  one. One implementation over IndexedDB; tests use an in-memory one. */
/** What the store caches, as reported to a reader: the run last seen, and per run and level how many events are
 *  stored and the extent cached. */
export type TEventStoreSummary = {
	lastRun?: string;
	runs: Array<{ run: string; levels: Array<{ level: string; stored: number; extent?: { total: number; first?: number; last?: number } }> }>;
	registry?: { savedAt: number };
};

export interface DeviceStore {
	/** The site's registry as cached here, or undefined when none has been. */
	registry(): Promise<TStoredRegistry | undefined>;
	/** Keep the server's registry: the step list response, as the server gave it now. */
	setRegistry(response: unknown): Promise<void>;
	/** What this store caches: per run and level, how many events and the extent cached, and the run last seen. */
	summary(): Promise<TEventStoreSummary>;
	/** Persist events (idempotent by key; a re-put of the same event is a no-op). Each carries its run. */
	putMany(events: readonly TStoredEvent[]): Promise<void>;
	/** The events of `run` whose index at `level` is in [start, end), in index order — ALL of them, or none: a page served
	 *  from the device is a page the device caches completely, never a page with rows missing in it. */
	pageAt(run: string, level: string, start: number, end: number): Promise<TStoredEvent[]>;
	/** What the device caches of that page, by index: a row for each event cached, a hole for each it lacks — for when there is
	 *  no server to query, and what the device caches is all there is to show. */
	rowsAt(run: string, level: string, start: number, end: number): Promise<Array<TStoredEvent | undefined>>;
	/** The run's extent at a level as last known (how many events it caches there, and when it began), for a tab with no
	 *  server to span its rail by. */
	extent(run: string, level: string): Promise<{ total: number; first?: number; last?: number } | undefined>;
	setExtent(run: string, level: string, extent: { total: number; first?: number; last?: number }): Promise<void>;
	/** The run last seen from the server, so a tab with no server reads the run it last cached rather than none. */
	lastRun(): Promise<string | undefined>;
	setLastRun(run: string): Promise<void>;
	/** Forget everything. */
	clear(): Promise<void>;
}

/** The run an event belongs to, as the server stamped it; "" for a server that names none (one run, then). */
export const runOf = (e: TStoredEvent): string => (typeof e.run === "string" ? e.run : "");

const DB_NAME = "shu-client-cache";
/** The database this one replaces, dropped once on open so a device does not keep both. */
const FORMER_DB_NAME = "shu-events";
/** Bumped when what is stored changes shape or meaning; an upgrade starts the store afresh (the server has the run). */
const VERSION = 1;
const EVENTS = "events";
const META = "meta";
/** One index per level over [run, the event's index at that level] (`idx.<level>`, stamped by the server); an event that
 *  does not count toward a level is simply absent from that level's index. */
const idxIndexName = (level: string): string => `by-run-idx-${level}`;
const EXTENT_KEY = (run: string, level: string): string => `extent:${run}:${level}`;
const LAST_RUN_KEY = "lastRun";
const REGISTRY_KEY = "registry";

/** An event's storage key: its run and its index among the run's events (`idx.debug`: every event counts at the lowest
 *  level), which the server stamps and which is unique by construction; an event a server did not index (none of this
 *  server's) is keyed by its time and identity instead, so a step's start and end (which share an id) are two rows. */
export const eventTime = (e: Record<string, unknown>): number => Number(e.timestamp) || 0;
export const storedEventKey = (e: TStoredEvent): string => {
	const idx = (e.idx as Record<string, number> | undefined)?.[HAIBUN_LOG_LEVELS[0]];
	if (typeof idx === "number") return `${runOf(e)}|${String(idx).padStart(12, "0")}`;
	return `${String(eventTime(e)).padStart(15, "0")}|${e.id}|${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;
};

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
		req.onsuccess = () => {
			resolve(req.result);
			indexedDB.deleteDatabase(FORMER_DB_NAME); // the former database, if this device has one; its events are on the server
		};
		req.onerror = () => {
			failFastOrLog("[device-store] open failed; the client cache will not persist:", req.error);
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

export class IndexedDbDeviceStore implements DeviceStore {
	async registry(): Promise<TStoredRegistry | undefined> {
		const found = await withStores("readonly", [META], (tx) => done(tx.objectStore(META).get(REGISTRY_KEY)));
		return found && typeof found === "object" ? (found as TStoredRegistry) : undefined;
	}

	async setRegistry(response: unknown): Promise<void> {
		const cached: TStoredRegistry = { savedAt: Date.now(), response };
		await withStores("readwrite", [META], (tx) => {
			tx.objectStore(META).put(cached, REGISTRY_KEY);
		});
	}

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
			const cached = await done(index.count(range));
			if (cached < end - start) return []; // not all of it: none of it, so the page is requested whole from the server
			return ((await done(index.getAll(range))) as Array<TStoredEvent & { __key: string; __run: string }>).map(({ __key, __run, ...event }) => event);
		});
		return rows ?? [];
	}

	async rowsAt(run: string, level: string, start: number, end: number): Promise<Array<TStoredEvent | undefined>> {
		if (end <= start) return [];
		const rows = await withStores("readonly", [EVENTS], async (tx) => {
			const index = tx.objectStore(EVENTS).index(idxIndexName(level));
			const cached = (await done(index.getAll(IDBKeyRange.bound([run, start], [run, end - 1])))) as Array<TStoredEvent & { __key: string; __run: string; idx: Record<string, number> }>;
			const out: Array<TStoredEvent | undefined> = new Array(end - start);
			for (const { __key, __run, ...event } of cached) out[(event.idx as Record<string, number>)[level] - start] = event;
			return out;
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

	async summary(): Promise<TEventStoreSummary> {
		const out = await withStores("readonly", [EVENTS, META], async (tx) => {
			const meta = tx.objectStore(META);
			const keys = (await done(meta.getAllKeys())) as string[];
			const values = (await done(meta.getAll())) as unknown[];
			const extents = new Map<string, Map<string, { total: number; first?: number; last?: number }>>();
			let lastRun: string | undefined;
			let registry: { savedAt: number } | undefined;
			keys.forEach((k, i) => {
				if (k === LAST_RUN_KEY) lastRun = String(values[i]);
				else if (k === REGISTRY_KEY) registry = { savedAt: (values[i] as TStoredRegistry).savedAt };
				else if (k.startsWith("extent:")) {
					const [, run, level] = k.split(":");
					if (!extents.has(run)) extents.set(run, new Map());
					extents.get(run)?.set(level, values[i] as { total: number; first?: number; last?: number });
				}
			});
			const events = tx.objectStore(EVENTS);
			const runs: TEventStoreSummary["runs"] = [];
			for (const [run, byLevel] of extents) {
				const levels: TEventStoreSummary["runs"][number]["levels"] = [];
				for (const level of HAIBUN_LOG_LEVELS) {
					const stored = await done(events.index(idxIndexName(level)).count(IDBKeyRange.bound([run, Number.NEGATIVE_INFINITY], [run, Number.POSITIVE_INFINITY])));
					const extent = byLevel.get(level);
					if (stored > 0 || extent) levels.push({ level, stored, extent });
				}
				runs.push({ run, levels });
			}
			return { lastRun, runs, registry };
		});
		return out ?? { runs: [] };
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

/** A `DeviceStore` over memory: what a context without IndexedDB gets, and what the unit tests drive. */
export class MemoryDeviceStore implements DeviceStore {
	#events = new Map<string, TStoredEvent>();
	#registry: TStoredRegistry | undefined;
	registry(): Promise<TStoredRegistry | undefined> {
		return Promise.resolve(this.#registry);
	}
	setRegistry(response: unknown): Promise<void> {
		this.#registry = { savedAt: Date.now(), response };
		return Promise.resolve();
	}
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
	rowsAt(run: string, level: string, start: number, end: number): Promise<Array<TStoredEvent | undefined>> {
		const out: Array<TStoredEvent | undefined> = new Array(Math.max(0, end - start));
		for (const e of this.#events.values()) {
			const i = (e.idx as Record<string, number> | undefined)?.[level];
			if (runOf(e) === run && i !== undefined && i >= start && i < end) out[i - start] = e;
		}
		return Promise.resolve(out);
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
	summary(): Promise<TEventStoreSummary> {
		const runs = new Set<string>([...this.#events.values()].map(runOf));
		for (const key of this.#extents.keys()) runs.add(key.slice(0, key.lastIndexOf(":")));
		return Promise.resolve({
			lastRun: this.#lastRun,
			registry: this.#registry ? { savedAt: this.#registry.savedAt } : undefined,
			runs: [...runs].map((run) => ({
				run,
				levels: HAIBUN_LOG_LEVELS.map((level) => ({
					level,
					stored: [...this.#events.values()].filter((e) => runOf(e) === run && (e.idx as Record<string, number> | undefined)?.[level] !== undefined).length,
					extent: this.#extents.get(`${run}:${level}`),
				})).filter((l) => l.stored > 0 || l.extent),
			})),
		});
	}
	setLastRun(run: string): Promise<void> {
		this.#lastRun = run;
		return Promise.resolve();
	}
	clear(): Promise<void> {
		this.#events.clear();
		this.#extents.clear();
		this.#lastRun = undefined;
		this.#registry = undefined;
		return Promise.resolve();
	}
	/** Test reading: how many events are stored. */
	get size(): number {
		return this.#events.size;
	}
}

/** Test/reset hook — drop the cached DB handle so a fresh open happens next. */
export function resetDeviceStoreIdb(): void {
	dbPromise = null;
}
