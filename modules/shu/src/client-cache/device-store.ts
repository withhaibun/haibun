/**
 * The device's store — the client cache's persistence: the graph this page holds and the site's registry (the step list
 * with its concerns and domains), off the JS heap and surviving a reload. A run is records in that graph, so a device
 * that read a run holds the run, and a tab with no server still reads what it holds and still knows the site's
 * declarations.
 *
 * Degrades by design: without IndexedDB (a standalone report, a context without it) every read returns empty and every
 * write is a no-op. Browser-only (IndexedDB is absent in jsdom/node) → exercised by the e2e suites, with an in-memory
 * stand-in for the unit tests. No dependency: raw IndexedDB, promisified.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { pagePinned } from "../page-pinned.js";

/** The site's registry as the device caches it: the step list response (steps, concerns, domains), and when it was cached. */
export type TStoredRegistry = { savedAt: number; response: unknown };

/** What the client cache requests of the device. One implementation over IndexedDB; tests use an in-memory one. */
export interface DeviceStore {
	/** The site's registry as last cached, or undefined. */
	registry(): Promise<TStoredRegistry | undefined>;
	/** Cache the site's registry response. */
	setRegistry(response: unknown): Promise<void>;
	/** Forget everything cached. */
	clear(): Promise<void>;
}

/** Pinned to the page, not to this module: the store instance is shared across the separately built bundles, so a write
 *  made through it must reach every bundle's readers, not only the one whose copy of this module performed it. */
const WRITE_LISTENERS_KEY = "__SHU_CLIENT_CACHE_WRITE_LISTENERS__";
const writeListeners = (): Set<() => void> => pagePinned(WRITE_LISTENERS_KEY, () => new Set<() => void>());

/** Be told when anything is written to the device: what a view reports of the cache is then read again. Writes are
 *  fire-and-forget, so a view that re-read only on its own notification would report a device state older than the
 *  one it holds. */
export function subscribeDeviceWrites(fn: () => void): () => void {
	writeListeners().add(fn);
	return () => writeListeners().delete(fn);
}

function wrote(): void {
	for (const fn of writeListeners()) fn();
}

const DB_NAME = "shu-client-cache";
/** The databases this one replaces, dropped once on open so a device does not keep them beside it. */
const FORMER_DB_NAMES = ["shu-events", "shu-graph"];
/** Bumped when the shape changes. An upgrade creates what is missing and keeps what is cached, and a page holding an
 *  earlier version closes its connection as soon as another page upgrades, so no page waits on another. */
const VERSION = 5;
const META = "meta";
/** The graph the page holds: quads, in the same database as the registry so the client cache has one lifecycle. */
export const QUADS = "quads";
export const IDX_QUAD_SPG = "by-spg";
export const IDX_QUAD_SUBJECT = "by-subject";
export const IDX_QUAD_NAMED_GRAPH = "by-named-graph";
const REGISTRY_KEY = "registry";
const SHAPE_KEY = "shape";
/** What the cached data means, apart from the database's structure. The schema version says which stores and indexes
 *  exist and upgrades additively; this says how what is in them is written and read. Change it whenever data written by
 *  an earlier build would be read wrongly by this one: the store then forgets what it cached rather than serving it. */
export const CACHE_SHAPE = "run-records/1";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null); // no IndexedDB here → reads stub, writes drop, and a view reads what the site answers
			return;
		}
		const req = indexedDB.open(DB_NAME, VERSION);
		// Additive: a version that adds a store or an index creates what is missing and keeps what a reader already
		// holds. Deleting the stores would drop every run on this device for a change that only extends the shape.
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
			store(META);
			// What an earlier build kept its events in: a run is records now, and they are read from the graph.
			if (db.objectStoreNames.contains("events")) db.deleteObjectStore("events");
		};
		// Another page of this origin is upgrading: this connection closes at once so it is not the reason that page waits.
		req.onblocked = () => console.warn("[device-store] another page of this origin holds an earlier version open; waiting for it to close");
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			for (const former of FORMER_DB_NAMES) indexedDB.deleteDatabase(former); // the databases this one replaces
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
 *  reading data written to another rule would report the wrong thing. */
function forgetIfIncompatible(db: IDBDatabase): Promise<void> {
	return new Promise((resolve) => {
		const tx = db.transaction([META, QUADS], "readwrite");
		const meta = tx.objectStore(META);
		const found = meta.get(SHAPE_KEY);
		found.onsuccess = () => {
			if (found.result === CACHE_SHAPE) return;
			if (found.result !== undefined) console.warn(`[device-store] what this device holds was written as ${String(found.result)}; this build reads ${CACHE_SHAPE}, so it is forgotten`);
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

	async clear(): Promise<void> {
		await withStores("readwrite", [META, QUADS], (tx) => {
			tx.objectStore(META).clear();
			tx.objectStore(QUADS).clear();
		});
		wrote();
	}
}

/** The same store in memory: what a report reads, and what the unit tests answer with. */
export class MemoryDeviceStore implements DeviceStore {
	#registry: TStoredRegistry | undefined;

	registry(): Promise<TStoredRegistry | undefined> {
		return Promise.resolve(this.#registry);
	}

	setRegistry(response: unknown): Promise<void> {
		this.#registry = { savedAt: Date.now(), response };
		wrote();
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.#registry = undefined;
		wrote();
		return Promise.resolve();
	}
}

/** The store the page reads and writes: one per page, so every bundle shares it. */
const STORE_KEY = "__SHU_DEVICE_STORE__";
const slot = (): { store: DeviceStore } => pagePinned(STORE_KEY, () => ({ store: new IndexedDbDeviceStore() }));

/** The device's store. */
export function deviceStore(): DeviceStore {
	return slot().store;
}

/** Install the store the page reads and writes (a report: memory, since every report shares one origin). */
export function setDeviceStore(store: DeviceStore): void {
	slot().store = store;
}

/** Test-only: open the database again on the next read. */
export function resetDeviceStoreIdb(): void {
	dbPromise = null;
}
