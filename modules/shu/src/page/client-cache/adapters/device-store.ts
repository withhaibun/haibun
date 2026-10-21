/**
 * The device's databases: one per actuality, named by its actuality id, each holding the graph the page holds of that
 * actuality and the site's registry, off the JS heap and surviving a reload. A device holds each actuality a page read, and a
 * tab without a server still reads those actualities and the site's declarations.
 *
 * Without IndexedDB (a standalone report, a context without it) a transaction resolves undefined: every read returns
 * empty and every write drops. It uses raw IndexedDB, promisified, without a dependency.
 */
import { CACHE_SHAPE, DEVICE_STORES, META_KEY, QUAD_INDEX, type TDeviceDatabase, type TDeviceReport, type TDeviceStore, type TStoredRegistry } from "../ports.js";

/** The device keeps each actuality's records in a database of its own, so a page never reads one actuality's records as another's. */
const DB_PREFIX = "shu-client-cache/";
/** The databases these replace, dropped once on open so a device doesn't keep them beside them. */
const FORMER_DB_NAMES = ["shu-events", "shu-graph", "shu-client-cache"];
/** Bumped when the shape changes. An upgrade creates what is missing and keeps what is cached, and a page holding an
 *  earlier version closes its connection as soon as another page upgrades, so a page doesn't wait on another. */
const VERSION = 7;

/** Returns the name of the database of the actuality `actualityId` names. */
export const databaseOf = (actualityId: string): string => `${DB_PREFIX}${actualityId}`;

/** Returns the names of the databases this device holds, one per actuality. */
export const heldDatabaseNames = async (): Promise<string[]> =>
	typeof indexedDB === "undefined" ? [] : (await indexedDB.databases()).flatMap(({ name }) => (name?.startsWith(DB_PREFIX) ? [name] : []));

/** Resolves a request's result, or rejects with its error. */
export const done = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** The page's one connection to each database, which every bundle on the page shares. `replacesFormer` drops the
 *  databases these replace once the database opens. */
export type TDeviceConnections = { opened: Map<string, Promise<IDBDatabase | null>>; report: TDeviceReport };

function openDb(name: string, connections: TDeviceConnections, replacesFormer: boolean): Promise<IDBDatabase | null> {
	const opened = connections.opened.get(name);
	if (opened) return opened;
	const opening = new Promise<IDBDatabase | null>((resolve) => {
		if (typeof indexedDB === "undefined") return resolve(null);
		const req = indexedDB.open(name, VERSION);
		// Additive: a version that adds a store or an index creates what is missing and keeps what a reader holds.
		req.onupgradeneeded = () => {
			const db = req.result;
			const tx = req.transaction as IDBTransaction;
			const store = (storeName: string, options?: IDBObjectStoreParameters): IDBObjectStore =>
				db.objectStoreNames.contains(storeName) ? tx.objectStore(storeName) : db.createObjectStore(storeName, options);
			const index = (on: IDBObjectStore, indexName: string, keyPath: string): void => {
				if (!on.indexNames.contains(indexName)) on.createIndex(indexName, keyPath, { unique: false });
			};
			const quads = store(DEVICE_STORES.QUADS, { autoIncrement: true });
			index(quads, QUAD_INDEX.SPG, "spg");
			index(quads, QUAD_INDEX.SUBJECT, "subject");
			index(quads, QUAD_INDEX.NAMED_GRAPH, "namedGraph");
			index(quads, QUAD_INDEX.OBJECT, "object");
			index(quads, QUAD_INDEX.TIME, "timestamp");
			store(DEVICE_STORES.META);
			// What an earlier build kept its events in: an actuality is records now, and they are read from the graph.
			if (db.objectStoreNames.contains("events")) db.deleteObjectStore("events");
		};
		// Another page of this origin is upgrading: this connection closes at once so it isn't the reason that page waits.
		req.onblocked = () => connections.report.warn("another page of this origin holds an earlier version open; waiting for it to close");
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				connections.opened.delete(name);
			};
			if (replacesFormer) for (const former of FORMER_DB_NAMES) indexedDB.deleteDatabase(former);
			void clearIfIncompatible(db, connections.report).then(() => resolve(db));
		};
		req.onerror = () => {
			resolve(null);
			connections.report.failure("the device's store didn't open, so the client cache doesn't persist", req.error);
		};
	});
	connections.opened.set(name, opening);
	return opening;
}

/** Clears what was cached under a different shape, and records the shape this build reads. The shape is read first, and the
 *  read and the clear each commit as they issue their requests, as every transaction here does. The database opens once the
 *  read ends and the clear is issued: the browser starts a later transaction over the same stores only after the clear ends. */
function clearIfIncompatible(db: IDBDatabase, report: TDeviceReport): Promise<void> {
	return new Promise((resolve) => {
		const read = db.transaction(DEVICE_STORES.META);
		const found = read.objectStore(DEVICE_STORES.META).get(META_KEY.SHAPE);
		read.commit();
		found.onerror = () => resolve();
		found.onsuccess = () => {
			if (found.result === CACHE_SHAPE) return resolve();
			if (found.result !== undefined) report.warn(`what this device holds was written as ${String(found.result)}; this build reads ${CACHE_SHAPE}, so it is cleared`);
			const tx = db.transaction([DEVICE_STORES.META, DEVICE_STORES.QUADS], "readwrite");
			tx.objectStore(DEVICE_STORES.QUADS).clear();
			tx.objectStore(DEVICE_STORES.META).clear();
			tx.objectStore(DEVICE_STORES.META).put(CACHE_SHAPE, META_KEY.SHAPE);
			tx.commit();
			resolve();
		};
	});
}

/** Returns the database `name` names, opened once through `connections`. A read or a write issues each of its requests in
 *  the task that opens its transaction and commits it there, so the browser ends the transaction without waiting for the page
 *  to take each result. Chromium aborts a transaction that waits on a page busy for 60 s while another transaction waits on
 *  it. */
export function deviceDatabase(name: string, connections: TDeviceConnections, replacesFormer: boolean): TDeviceDatabase {
	/** Runs `fn` in a transaction over `stores` and commits the requests it issues, and resolves with its result once the
	 *  transaction commits, or rejects with why it aborted; resolves undefined without IndexedDB. */
	const within = async <T>(mode: IDBTransactionMode, stores: string[], fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T | undefined> => {
		const db = await openDb(name, connections, replacesFormer);
		if (db === null) return undefined;
		const tx = db.transaction(stores, mode);
		const committed = new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
		});
		const issued = (async () => fn(tx))();
		tx.commit();
		// Awaited together, so the abort that follows a failure of `fn` doesn't reject a second time, unhandled.
		const [result] = await Promise.all([issued, committed]);
		return result;
	};
	return { name, read: (stores, fn) => within("readonly", stores, fn), write: (stores, fn) => within("readwrite", stores, fn) };
}

/** The site's registry and the clearing of what is cached, in one actuality's database. `wrote` calls the page's readers
 *  on each change of the device. */
export class IndexedDbDeviceStore implements TDeviceStore {
	constructor(
		private readonly database: TDeviceDatabase,
		private readonly wrote: () => void,
	) {}

	async registry(): Promise<TStoredRegistry | undefined> {
		const found = await this.database.read([DEVICE_STORES.META], (tx) => done(tx.objectStore(DEVICE_STORES.META).get(META_KEY.REGISTRY)));
		return found !== undefined && found !== null && typeof found === "object" ? (found as TStoredRegistry) : undefined;
	}

	async setRegistry(response: unknown): Promise<void> {
		const cached: TStoredRegistry = { savedAt: Date.now(), response };
		await this.database.write([DEVICE_STORES.META], (tx) => tx.objectStore(DEVICE_STORES.META).put(cached, META_KEY.REGISTRY));
		this.wrote();
	}

	async clear(): Promise<void> {
		await this.database.write([DEVICE_STORES.META, DEVICE_STORES.QUADS], (tx) => {
			tx.objectStore(DEVICE_STORES.META).clear();
			tx.objectStore(DEVICE_STORES.QUADS).clear();
		});
		this.wrote();
	}
}

/** The same store in memory: what a report reads, and what the unit tests install. */
export class MemoryDeviceStore implements TDeviceStore {
	#registry: TStoredRegistry | undefined;

	constructor(private readonly wrote: () => void) {}

	registry(): Promise<TStoredRegistry | undefined> {
		return Promise.resolve(this.#registry);
	}

	setRegistry(response: unknown): Promise<void> {
		this.#registry = { savedAt: Date.now(), response };
		this.wrote();
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.#registry = undefined;
		this.wrote();
		return Promise.resolve();
	}
}
