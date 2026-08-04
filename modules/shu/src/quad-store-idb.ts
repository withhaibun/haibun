/**
 * IndexedDbQuadStore — the client-side `IQuadStore`: the persistent graph backing behind the in-memory `QuadGraphModel`
 * (server uses AGE, client uses IndexedDB — see quad-graph-model.ts "the backing store ... is the IQuadStore behind the
 * model"). Quad observations stream in via `set()` (upsert by subject+predicate+namedGraph, so the live graph stays
 * bounded rather than appending a row per update), and a view derefs a node by `@id` via `query({ subject })`. The bulk
 * lives here, off the JS heap and off the event log — events carry references, not payloads.
 *
 * Degrades by design: when IndexedDB is unavailable (a standalone report has none, or any context without it) every read
 * returns empty, so the view renders a stub. Browser-only (IndexedDB is absent in jsdom/node) → exercised by the e2e
 * suites, not unit tests. No dependency: raw IndexedDB, promisified.
 */
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import type { IQuadStore, TClusteredQuads, TQuad, TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";

/** The server-side query surface the client delegates rather than reimplements — heavy queries stay server-side via RPC. */
type RemoteQuery = Pick<IQuadStore, "queryIndividuals" | "distinctPropertyValues" | "getClusteredQuads">;

const DB_NAME = "shu-graph";
const STORE = "quads";
const VERSION = 1;
const IDX_SPG = "by-spg";
const IDX_SUBJECT = "by-subject";
const IDX_NAMED_GRAPH = "by-named-graph";

/** A stored quad carries a derived `spg` (namedGraph|subject|predicate) key so `set`/`get` can upsert without a scan. */
type StoredQuad = TQuad & { spg: string };
const spgKey = (namedGraph: string, subject: string, predicate: string): string => `${namedGraph}|${subject}|${predicate}`;
const strip = ({ spg, ...quad }: StoredQuad): TQuad => quad;
const objectEquals = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const matchesPattern = (q: TQuad, p: TQuadPattern): boolean =>
	(p.subject === undefined || q.subject === p.subject) &&
	(p.predicate === undefined || q.predicate === p.predicate) &&
	(p.namedGraph === undefined || q.namedGraph === p.namedGraph) &&
	(p.object === undefined || objectEquals(q.object, p.object));

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve(null); // a report context without IndexedDB → reads stub
			return;
		}
		const req = indexedDB.open(DB_NAME, VERSION);
		req.onupgradeneeded = () => {
			const store = req.result.createObjectStore(STORE, { autoIncrement: true });
			store.createIndex(IDX_SPG, "spg", { unique: false });
			store.createIndex(IDX_SUBJECT, "subject", { unique: false });
			store.createIndex(IDX_NAMED_GRAPH, "namedGraph", { unique: false });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			failFastOrLog("[quad-store-idb] open failed; graph reads will stub:", req.error);
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

/** Run `fn` in one transaction and resolve once it commits; resolves `undefined` when IndexedDB is unavailable. */
async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T | undefined> {
	const db = await openDb();
	if (!db) return undefined;
	const tx = db.transaction(STORE, mode);
	const result = await fn(tx.objectStore(STORE));
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	return result;
}

export class IndexedDbQuadStore implements IQuadStore {
	/** @param remote server delegate for the query surface; unwired, those methods throw rather than silently return empty. */
	constructor(private readonly remote?: RemoteQuery) {}

	async set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		const spg = spgKey(namedGraph, subject, predicate);
		await withStore("readwrite", async (store) => {
			for (const key of await done(store.index(IDX_SPG).getAllKeys(spg))) store.delete(key);
			store.add({ subject, predicate, object, namedGraph, timestamp: Date.now(), properties, spg } satisfies StoredQuad);
		});
	}

	async get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		const matches = await this.query({ subject, predicate, namedGraph });
		return matches.length ? matches.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)).object : undefined;
	}

	async add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		await withStore("readwrite", (store) => {
			store.add({ ...quad, timestamp: Date.now(), spg: spgKey(quad.namedGraph, quad.subject, quad.predicate) } satisfies StoredQuad);
		});
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		const rows = await withStore("readonly", async (store) => {
			// Narrow with the most selective available index, then filter the remaining fields.
			const indexed =
				pattern.subject !== undefined
					? await done(store.index(IDX_SUBJECT).getAll(pattern.subject))
					: pattern.namedGraph !== undefined
						? await done(store.index(IDX_NAMED_GRAPH).getAll(pattern.namedGraph))
						: await done(store.getAll());
			return (indexed as StoredQuad[]).filter((q) => matchesPattern(q, pattern)).map(strip);
		});
		return rows ?? [];
	}

	async clear(namedGraph?: string): Promise<void> {
		await withStore("readwrite", async (store) => {
			if (namedGraph === undefined) {
				store.clear();
				return;
			}
			for (const key of await done(store.index(IDX_NAMED_GRAPH).getAllKeys(namedGraph))) store.delete(key);
		});
	}

	async remove(pattern: TQuadPattern): Promise<void> {
		await withStore("readwrite", async (store) => {
			await new Promise<void>((resolve, reject) => {
				const req = store.openCursor();
				req.onsuccess = () => {
					const cursor = req.result;
					if (!cursor) {
						resolve();
						return;
					}
					if (matchesPattern(cursor.value as StoredQuad, pattern)) cursor.delete();
					cursor.continue();
				};
				req.onerror = () => reject(req.error);
			});
		});
	}

	async all(): Promise<TQuad[]> {
		const rows = await withStore("readonly", async (store) => ((await done(store.getAll())) as StoredQuad[]).map(strip));
		return rows ?? [];
	}

	/** Batch upsert in one transaction — each quad replaces any prior quad with the same subject+predicate+namedGraph,
	 *  so persisting a live merge batch keeps the stored graph bounded (one row per fact) rather than appending. */
	async setMany(quads: TQuad[]): Promise<void> {
		if (quads.length === 0) return;
		await withStore("readwrite", async (store) => {
			for (const quad of quads) {
				const spg = spgKey(quad.namedGraph, quad.subject, quad.predicate);
				for (const key of await done(store.index(IDX_SPG).getAllKeys(spg))) store.delete(key);
				store.add({ ...quad, spg } satisfies StoredQuad);
			}
		});
	}

	// --- Individual convenience ops: persist + deref-by-@id, the client store's actual job, over the quad primitives. ---

	async upsertIndividual(label: string, data: unknown): Promise<string> {
		const obj = data as Record<string, unknown>;
		const id = obj["@id"];
		if (typeof id !== "string")
			throw new Error(`IndexedDbQuadStore.upsertIndividual: data has no string @id — the client store caches fetched nodes keyed by @id (got ${JSON.stringify(id)}).`);
		for (const [predicate, value] of Object.entries(obj)) if (predicate !== "@id") await this.set(id, predicate, value, label);
		return id;
	}

	async getIndividual<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
		const quads = await this.query({ subject: id, namedGraph: label });
		if (!quads.length) return undefined;
		const individual: Record<string, unknown> = { "@id": id, "@type": label };
		for (const q of quads) individual[q.predicate] = q.object;
		return individual as T;
	}

	async deleteIndividual(label: string, id: string): Promise<void> {
		await this.remove({ subject: id, namedGraph: label });
	}

	// --- Query surface: server-side (the client is not a query engine) — delegate to the wired remote or fail clearly. ---

	private requireRemote(method: string): RemoteQuery {
		if (!this.remote)
			throw new Error(
				`IndexedDbQuadStore.${method}: the client store is persist + deref-by-@id, not a query engine — heavy queries stay server-side; wire a remote (server RPC) to run them.`,
			);
		return this.remote;
	}

	async queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
		return await this.requireRemote("queryIndividuals").queryIndividuals<T>(label, filters, options);
	}

	async distinctPropertyValues(label: string, property: string): Promise<string[]> {
		return await this.requireRemote("distinctPropertyValues").distinctPropertyValues(label, property);
	}

	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel }): Promise<TClusteredQuads> {
		return await this.requireRemote("getClusteredQuads").getClusteredQuads(opts);
	}
}

/** Test/reset hook — drop the cached DB handle so a fresh open happens next. */
export function resetQuadStoreIdb(): void {
	dbPromise = null;
}
