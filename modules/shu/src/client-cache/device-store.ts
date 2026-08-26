/**
 * The device's store — the client cache's persistence: the bulk lives here, off
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
import { pagePinned } from "../page-pinned.js";

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
	runs: Array<{ run: string; features: string[]; first?: number; last?: number; levels: Array<{ level: string; stored: number; extent?: { total: number; first?: number; last?: number } }> }>;
	registry?: { savedAt: number };
};

/** What a run was, as the device caches it: the features it ran, when it began and when it last changed. Written from the
 *  events themselves, so a run is presentable by what it did rather than by the id the server gave it. */
export type TStoredRun = { features: string[]; first?: number; last?: number };

/** The features a batch of events names, and the instants it spans: what a run record is updated from. */
export function runFactsIn(events: readonly TStoredEvent[]): Map<string, TStoredRun> {
	const facts = new Map<string, TStoredRun>();
	for (const e of events) {
		const run = runOf(e);
		const at = eventTime(e);
		const fact = facts.get(run) ?? { features: [] };
		if (at > 0) {
			fact.first = fact.first === undefined ? at : Math.min(fact.first, at);
			fact.last = fact.last === undefined ? at : Math.max(fact.last, at);
		}
		const named = e.kind === "lifecycle" && e.type === "feature" && e.stage === "start" ? String(e.featureName ?? e.featurePath ?? "") : "";
		if (named && !fact.features.includes(named)) fact.features.push(named);
		facts.set(run, fact);
	}
	return facts;
}

/** A run record and what a batch says about it, as one record. */
export function mergeRunFacts(cached: TStoredRun | undefined, fact: TStoredRun): TStoredRun {
	const features = [...(cached?.features ?? [])];
	for (const name of fact.features) if (!features.includes(name)) features.push(name);
	const firsts = [cached?.first, fact.first].filter((n): n is number => typeof n === "number");
	const lasts = [cached?.last, fact.last].filter((n): n is number => typeof n === "number");
	return { features, first: firsts.length ? Math.min(...firsts) : undefined, last: lasts.length ? Math.max(...lasts) : undefined };
}

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
	/** Keep the newest `keep` runs and the run named in `reading`; forget every other run's events and extents. Returns the
	 *  runs forgotten. A device caches every run it has seen, so without this it grows without bound. */
	cullRuns(keep: number, reading?: string): Promise<string[]>;
	/** Forget everything. */
	clear(): Promise<void>;
}

/** The runs a summary reports, newest first by the last instant cached for them; a run with no instant sorts last. */
export function runsNewestFirst(summary: TEventStoreSummary): Array<{ run: string; last: number }> {
	return summary.runs
		.map((r) => ({ run: r.run, last: Math.max(0, r.last ?? 0, ...r.levels.map((l) => l.extent?.last ?? 0)) }))
		.sort((a, b) => b.last - a.last);
}

/** The runs to forget: every run but the newest `keep` and the one being read. */
export function runsToForget(summary: TEventStoreSummary, keep: number, reading?: string): string[] {
	const kept = new Set(runsNewestFirst(summary).slice(0, Math.max(0, keep)).map((r) => r.run));
	if (reading !== undefined) kept.add(reading);
	return summary.runs.map((r) => r.run).filter((run) => !kept.has(run));
}

/** Pinned to the page, not to this module: the store instance is shared across the separately built bundles, so a write
 *  made through it must reach every bundle's readers, not only the one whose copy of this module performed it. */
const WRITE_LISTENERS_KEY = "__SHU_CLIENT_CACHE_WRITE_LISTENERS__";
const writeListeners = (): Set<() => void> => pagePinned(WRITE_LISTENERS_KEY, () => new Set<() => void>());

/** Be told when anything is written to the device: what a view reports of the cache is then read again. Writes are
 *  fire-and-forget from the sources, so a view that re-read only on a source's own notification would report a device
 *  state older than the one it caches. */
export function subscribeDeviceWrites(fn: () => void): () => void {
	writeListeners().add(fn);
	return () => writeListeners().delete(fn);
}

function wrote(): void {
	for (const fn of writeListeners()) fn();
}

/** The run an event belongs to, as the server stamped it; "" for a server that names none (one run, then). */
export const runOf = (e: TStoredEvent): string => (typeof e.run === "string" ? e.run : "");

const DB_NAME = "shu-client-cache";
/** The databases this one replaces, dropped once on open so a device does not keep them beside it. */
const FORMER_DB_NAMES = ["shu-events", "shu-graph"];
/** Bumped when the shape changes. An upgrade creates what is missing and keeps what is cached, and a page holding an
 *  earlier version closes its connection as soon as another page upgrades, so no page waits on another. */
const VERSION = 4;
const EVENTS = "events";
const META = "meta";
/** The graph the page caches: quads, kept in the same database as the events so the client cache has one lifecycle. */
export const QUADS = "quads";
export const IDX_QUAD_SPG = "by-spg";
export const IDX_QUAD_SUBJECT = "by-subject";
export const IDX_QUAD_NAMED_GRAPH = "by-named-graph";
/** One index per level over [run, the event's index at that level] (`idx.<level>`, stamped by the server); an event that
 *  does not count toward a level is simply absent from that level's index. */
const idxIndexName = (level: string): string => `by-run-idx-${level}`;
/** Every event's run, so the runs this store caches are read without a walk over the events themselves. */
const IDX_RUN = "by-run";
const EXTENT_KEY = (run: string, level: string): string => `extent:${run}:${level}`;
const LAST_RUN_KEY = "lastRun";
const REGISTRY_KEY = "registry";
const SHAPE_KEY = "shape";
/** What the cached data means, apart from the database's structure. The schema version says which stores and indexes
 *  exist and upgrades additively; this says how what is in them is written and read — the storage key rule, what an
 *  event keeps, what a run record holds. Change it whenever cached data written by an earlier build would be read
 *  wrongly by this one: the store then forgets what it cached rather than serving it, and says so. */
export const CACHE_SHAPE = "run-indexed-events/1";
const RUN_KEY = (run: string): string => `run:${run}`;

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
		// Additive: a version that adds a store or an index creates what is missing and keeps what a reader already
		// cached. Deleting the stores would drop every run on this device for a change that only extends the shape.
		req.onupgradeneeded = () => {
			const db = req.result;
			const tx = req.transaction as IDBTransaction;
			const store = (name: string, options?: IDBObjectStoreParameters): IDBObjectStore => (db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, options));
			const index = (on: IDBObjectStore, name: string, keyPath: string | string[]): void => {
				if (!on.indexNames.contains(name)) on.createIndex(name, keyPath, { unique: false });
			};
			const quads = store(QUADS, { autoIncrement: true });
			index(quads, IDX_QUAD_SPG, "spg");
			index(quads, IDX_QUAD_SUBJECT, "subject");
			index(quads, IDX_QUAD_NAMED_GRAPH, "namedGraph");
			const events = store(EVENTS, { keyPath: "__key" });
			index(events, IDX_RUN, "__run");
			for (const level of HAIBUN_LOG_LEVELS) index(events, idxIndexName(level), ["__run", `idx.${level}`]);
			store(META);
		};
		// Another page of this origin is upgrading: this connection closes at once so it is not the reason that page waits.
		req.onblocked = () => console.warn("[device-store] another page of this origin holds an earlier version open; waiting for it to close");
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			for (const former of FORMER_DB_NAMES) indexedDB.deleteDatabase(former); // the databases this one replaces; what they cached is on the server
			void forgetIfIncompatible(db).then(() => resolve(db));
		};
		req.onerror = () => {
			failFastOrLog("[device-store] open failed; the client cache will not persist:", req.error);
			resolve(null);
		};
	});
	return dbPromise;
}

/** Forget what was cached under a different shape, and record the shape this build reads. What is forgotten is a cache:
 *  the run is on the server, and reading data written to another rule would report the wrong thing. */
function forgetIfIncompatible(db: IDBDatabase): Promise<void> {
	return new Promise((resolve) => {
		const tx = db.transaction([EVENTS, META, QUADS], "readwrite");
		const meta = tx.objectStore(META);
		const found = meta.get(SHAPE_KEY);
		found.onsuccess = () => {
			if (found.result === CACHE_SHAPE) return;
			if (found.result !== undefined) console.warn(`[device-store] what this device cached was written as ${String(found.result)}; this build reads ${CACHE_SHAPE}, so the cache is forgotten`);
			tx.objectStore(EVENTS).clear();
			tx.objectStore(QUADS).clear();
			meta.clear();
			meta.put(CACHE_SHAPE, SHAPE_KEY);
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => resolve();
	});
}

export const done = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** Run `fn` in one transaction over the named stores and resolve once it commits; `undefined` when IndexedDB is unavailable. */
export async function withStores<T>(mode: IDBTransactionMode, names: string[], fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T | undefined> {
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
		wrote();
	}

	async putMany(events: readonly TStoredEvent[]): Promise<void> {
		if (events.length === 0) return;
		await withStores("readwrite", [EVENTS, META], async (tx) => {
			const store = tx.objectStore(EVENTS);
			for (const e of events) store.put({ ...e, __key: storedEventKey(e), __run: runOf(e) });
			const meta = tx.objectStore(META);
			for (const [run, fact] of runFactsIn(events)) {
				const cached = (await done(meta.get(RUN_KEY(run)))) as TStoredRun | undefined;
				meta.put(mergeRunFacts(cached, fact), RUN_KEY(run));
			}
		});
		wrote();
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
		wrote();
	}

	async summary(): Promise<TEventStoreSummary> {
		const out = await withStores("readonly", [EVENTS, META], async (tx) => {
			const meta = tx.objectStore(META);
			const keys = (await done(meta.getAllKeys())) as string[];
			const values = (await done(meta.getAll())) as unknown[];
			const extents = new Map<string, Map<string, { total: number; first?: number; last?: number }>>();
			let lastRun: string | undefined;
			let registry: { savedAt: number } | undefined;
			const runRecords = new Map<string, TStoredRun>();
			keys.forEach((k, i) => {
				if (k === LAST_RUN_KEY) lastRun = String(values[i]);
				else if (k === REGISTRY_KEY) registry = { savedAt: (values[i] as TStoredRegistry).savedAt };
				else if (k === SHAPE_KEY) return;
				else if (k.startsWith("run:")) runRecords.set(k.slice("run:".length), values[i] as TStoredRun);
				else if (k.startsWith("extent:")) {
					const [, run, level] = k.split(":");
					if (!extents.has(run)) extents.set(run, new Map());
					extents.get(run)?.set(level, values[i] as { total: number; first?: number; last?: number });
				}
			});
			const events = tx.objectStore(EVENTS);
			// Every run this store caches: the runs it has events for, and the runs it has an extent for, which are not the
			// same set — a page cached before its extent was recorded belongs to a run all the same.
			const seen = new Set(extents.keys());
			// One step per distinct run, not per event: a key cursor over the run index skips to the next run each time.
			await new Promise<void>((resolve, reject) => {
				const req = events.index(IDX_RUN).openKeyCursor(null, "nextunique");
				req.onsuccess = () => {
					const cursor = req.result;
					if (!cursor) return resolve();
					seen.add(String(cursor.key));
					cursor.continue();
				};
				req.onerror = () => reject(req.error);
			});
			const runs: TEventStoreSummary["runs"] = [];
			for (const run of seen) {
				const byLevel = extents.get(run) ?? new Map<string, { total: number; first?: number; last?: number }>();
				const levels: TEventStoreSummary["runs"][number]["levels"] = [];
				for (const level of HAIBUN_LOG_LEVELS) {
					const stored = await done(events.index(idxIndexName(level)).count(IDBKeyRange.bound([run, Number.NEGATIVE_INFINITY], [run, Number.POSITIVE_INFINITY])));
					const extent = byLevel.get(level);
					if (stored > 0 || extent) levels.push({ level, stored, extent });
				}
				const record = runRecords.get(run);
				runs.push({ run, features: record?.features ?? [], first: record?.first, last: record?.last, levels });
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
		wrote();
	}

	async cullRuns(keep: number, reading?: string): Promise<string[]> {
		const forget = runsToForget(await this.summary(), keep, reading);
		if (forget.length === 0) return [];
		await withStores("readwrite", [EVENTS, META], async (tx) => {
			const events = tx.objectStore(EVENTS);
			const meta = tx.objectStore(META);
			for (const run of forget) {
				for (const key of (await done(events.index(IDX_RUN).getAllKeys(IDBKeyRange.only(run)))) as IDBValidKey[]) events.delete(key);
				for (const level of HAIBUN_LOG_LEVELS) meta.delete(EXTENT_KEY(run, level));
				meta.delete(RUN_KEY(run));
			}
		});
		wrote();
		return forget;
	}

	async clear(): Promise<void> {
		await withStores("readwrite", [EVENTS, META, QUADS], (tx) => {
			tx.objectStore(EVENTS).clear();
			tx.objectStore(META).clear();
			tx.objectStore(QUADS).clear();
		});
		wrote();
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
		wrote();
		return Promise.resolve();
	}
	#extents = new Map<string, { total: number; first?: number; last?: number }>();
	#runs = new Map<string, TStoredRun>();
	putMany(events: readonly TStoredEvent[]): Promise<void> {
		for (const e of events) this.#events.set(storedEventKey(e), e);
		for (const [run, fact] of runFactsIn(events)) this.#runs.set(run, mergeRunFacts(this.#runs.get(run), fact));
		wrote();
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
		wrote();
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
				features: this.#runs.get(run)?.features ?? [],
				first: this.#runs.get(run)?.first,
				last: this.#runs.get(run)?.last,
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
		wrote();
		return Promise.resolve();
	}
	async cullRuns(keep: number, reading?: string): Promise<string[]> {
		const forget = runsToForget(await this.summary(), keep, reading);
		const forgotten = new Set(forget);
		for (const [key, e] of [...this.#events.entries()]) if (forgotten.has(runOf(e))) this.#events.delete(key);
		for (const key of [...this.#extents.keys()]) if (forgotten.has(key.slice(0, key.lastIndexOf(":")))) this.#extents.delete(key);
		for (const run of forgotten) this.#runs.delete(run);
		wrote();
		return forget;
	}
	clear(): Promise<void> {
		this.#events.clear();
		this.#extents.clear();
		this.#runs.clear();
		this.#lastRun = undefined;
		this.#registry = undefined;
		wrote();
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
