/**
 * The graph this page caches, as an `IQuadStore`: the persistent backing behind the in-memory `QuadGraphModel`. Quad
 * observations arrive through `set()` (upsert by subject, predicate and named graph, so the cached graph stays one row
 * per fact rather than a row per update), and a view dereferences a node by `@id` through `query({ subject })`. It lives
 * in the client cache's one database beside the events and the registry, so the page has one cache with one lifecycle.
 *
 * Degrades by design: without IndexedDB (a report, or any context without it) every read returns empty and the view
 * renders what it has. Every read, the query surface included, is answered from what this page caches: the site serves
 * the graph while it can be reached, and the page reads the same store either way, so a view offline sees what it holds
 * rather than nothing. What it holds is what the site already served this reader, so a read of it gates nothing further.
 */
import { LinkRelations, withinAccess, type AccessLevel } from "@haibun/core/lib/resources.js";
import { matchesQuadPattern, type IQuadStore, type TClusteredQuads, type TDensityQuery, type TDensityResult, type TQuad, type TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { densityOverQuadStore, sliceQuadsPerType } from "@haibun/core/lib/quad-store.js";
import { QUADS, IDX_QUAD_SPG, IDX_QUAD_SUBJECT, IDX_QUAD_NAMED_GRAPH, IDX_QUAD_OBJECT, done, withStores as withClientCacheStores } from "./device-store.js";

/** A stored quad carries a derived `spg` (namedGraph|subject|predicate) key so `set`/`get` can upsert without a scan. */
type StoredQuad = TQuad & { spg: string };
const spgKey = (namedGraph: string, subject: string, predicate: string): string => `${namedGraph}|${subject}|${predicate}`;
const strip = ({ spg, ...quad }: StoredQuad): TQuad => quad;

/** Run `fn` in one transaction over the quads, and resolve once it commits; `undefined` when IndexedDB is unavailable. */
const withStore = <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T | undefined> =>
	withClientCacheStores(mode, [QUADS], (tx) => fn(tx.objectStore(QUADS)));

export class IndexedDbQuadStore implements IQuadStore {
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
			// Narrow with the most selective index the pattern names, then filter the remaining fields. An object is an
			// index key where it names an individual (an id); any other value is matched after the widest read.
			const keyed = typeof pattern.object === "string" || typeof pattern.object === "number";
			const by: [string, IDBValidKey] | undefined =
				pattern.subject !== undefined
					? [IDX_QUAD_SUBJECT, pattern.subject]
					: keyed
						? [IDX_QUAD_OBJECT, pattern.object as IDBValidKey]
						: pattern.namedGraph !== undefined
							? [IDX_QUAD_NAMED_GRAPH, pattern.namedGraph]
							: undefined;
			const indexed = by ? await done(store.index(by[0]).getAll(by[1])) : await done(store.getAll());
			return (indexed as StoredQuad[]).filter((q) => matchesQuadPattern(q, pattern)).map(strip);
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
					if (matchesQuadPattern(cursor.value as StoredQuad, pattern)) cursor.delete();
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
		const [id, quads] = individualAsQuads(label, data as Record<string, unknown>);
		await this.setMany(quads);
		return id;
	}

	async getIndividual<T = Record<string, unknown>>(label: string, id: string): Promise<T | undefined> {
		const quads = await this.query({ subject: id, namedGraph: label });
		return quads.length ? (individualFrom(label, id, quads) as T) : undefined;
	}

	async deleteIndividual(label: string, id: string): Promise<void> {
		await this.remove({ subject: id, namedGraph: label });
	}

	// --- Query surface, answered over the cached quads: the same questions the site answers, asked of what this page holds. ---

	async queryIndividuals<T = Record<string, unknown>>(label: string, filters?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]> {
		// The graph's quads once, grouped by subject in one pass: building each individual by scanning the graph's quads
		// again cost a read of a type its individuals times its quads.
		const bySubject = new Map<string, Record<string, unknown>>();
		for (const q of await this.query({ namedGraph: label })) {
			let individual = bySubject.get(q.subject);
			if (!individual) {
				individual = { "@id": q.subject, "@type": label };
				bySubject.set(q.subject, individual);
			}
			individual[q.predicate] = q.object;
		}
		let individuals = [...bySubject.values()];
		for (const [predicate, value] of Object.entries(filters ?? {})) individuals = individuals.filter((i) => i[predicate] === value);
		const offset = options?.offset ?? 0;
		return individuals.slice(offset, offset + (options?.limit ?? individuals.length)) as T[];
	}

	density(query: TDensityQuery): Promise<TDensityResult> {
		return densityOverQuadStore(this, query);
	}

	async distinctPropertyValues(label: string, property: string): Promise<string[]> {
		const quads = await this.query({ predicate: property, namedGraph: label });
		return [...new Set(quads.map((q) => String(q.object)))].sort();
	}

	async getClusteredQuads(opts: { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel }): Promise<TClusteredQuads> {
		const quads = await this.all();
		const types = opts.types;
		const asked = types ? quads.filter((q) => types.includes(q.namedGraph)) : quads;
		// A page holds what it was served, which may have been read at a wider level than this one asks for. A read here
		// answers what the site would have: a record stating a level beyond what was asked is not in it, so the control a
		// reader sets means the same thing whether or not there is a server behind the page.
		return sliceQuadsPerType(
			asked.filter((q) => withinAccess(levelOf(asked, q), opts.accessLevel)),
			opts.perTypeLimit,
		);
	}
}

/** One individual as the quads that state it. Exported so what a page holds a window of records by is one write of the
 *  same quads a single upsert would have written. A record's identity is its `@id`, else the `id` it states: the page holds
 *  what a site serves and what a site records, and both name themselves. */
export function individualAsQuads(label: string, individual: Record<string, unknown>): [string, TQuad[]] {
	const id = individual["@id"] ?? individual.id;
	if (typeof id !== "string")
		throw new Error(`IndexedDbQuadStore: this individual states no identity, so there is nothing to hold it by (got ${JSON.stringify(individual["@id"] ?? individual.id)}).`);
	const quads = Object.entries(individual)
		.filter(([predicate]) => predicate !== "@id")
		.map(([predicate, object]) => ({ subject: id, predicate, object, namedGraph: label, timestamp: Date.now() }));
	return [id, quads];
}

/** The access level a subject states, from the quads describing it: what it was recorded at, where it says. */
function levelOf(quads: TQuad[], of: TQuad): unknown {
	return quads.find((q) => q.subject === of.subject && q.namedGraph === of.namedGraph && q.predicate === LinkRelations.ACCESS_LEVEL.rel)?.object;
}

/** One subject's quads read as a record: its `@id` and type, then a field per predicate. The page caches what it
 *  dereferenced by `@id`, so that is the identity a record it returns carries. */
function individualFrom(label: string, subject: string, quads: TQuad[]): Record<string, unknown> {
	const individual: Record<string, unknown> = { "@id": subject, "@type": label };
	for (const q of quads) if (q.subject === subject) individual[q.predicate] = q.object;
	return individual;
}

/** The store this page caches the graph in, on a served origin: one per page, beside the events and the registry. A page
 *  that carries its own graph (a report) installs one of its own through `setGraphStore`. */
export const originGraphStore = new IndexedDbQuadStore();
