/**
 * The graph this page caches, as an `IQuadStore`: the persistent backing behind the in-memory `QuadGraphModel`. Quad
 * observations arrive through `set()` (upsert by subject, predicate and named graph, so the cached graph stays one row
 * per fact rather than a row per update), and a view dereferences a node by `@id` through `query({ subject })`. It lives
 * in the client cache's one database beside the events and the registry, so the page has one cache with one lifecycle.
 *
 * Degrades by design: without IndexedDB (a report, or any context without it) every read returns empty and the view
 * renders what it has. Queries the server's engine answers (filtered individual queries, distinct values over the whole
 * graph, clustering) are delegated to the wired remote rather than reimplemented here.
 */
import type { AccessLevel } from "@haibun/core/lib/resources.js";
import type { IQuadStore, TClusteredQuads, TQuad, TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { QUADS, IDX_QUAD_SPG, IDX_QUAD_SUBJECT, IDX_QUAD_NAMED_GRAPH, done, withStores as withClientCacheStores } from "./device-store.js";

/** The server-side query surface the client delegates rather than reimplements — heavy queries stay server-side via RPC. */
type RemoteQuery = Pick<IQuadStore, "queryIndividuals" | "distinctPropertyValues" | "getClusteredQuads">;


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

/** Run `fn` in one transaction over the quads, and resolve once it commits; `undefined` when IndexedDB is unavailable. */
const withStore = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T | undefined> =>
	withClientCacheStores(mode, [QUADS], (tx) => fn(tx.objectStore(QUADS)));

export class IndexedDbQuadStore implements IQuadStore {
	/** @param remote server delegate for the query surface; unwired, those methods throw rather than silently return empty. */
	constructor(private readonly remote?: RemoteQuery) {}

	async set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		const spg = spgKey(namedGraph, subject, predicate);
		await withStore("readwrite", async (store) => {
			for (const key of await done(store.index(IDX_QUAD_SPG).getAllKeys(spg))) store.delete(key);
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
					? await done(store.index(IDX_QUAD_SUBJECT).getAll(pattern.subject))
					: pattern.namedGraph !== undefined
						? await done(store.index(IDX_QUAD_NAMED_GRAPH).getAll(pattern.namedGraph))
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
			for (const key of await done(store.index(IDX_QUAD_NAMED_GRAPH).getAllKeys(namedGraph))) store.delete(key);
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
				for (const key of await done(store.index(IDX_QUAD_SPG).getAllKeys(spg))) store.delete(key);
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

