/**
 * The quads one actuality's database holds on the device. A quad observation is an upsert by subject, predicate and named
 * graph, so the database holds one row per fact rather than a row per update. Without IndexedDB (a report, or a context
 * without it) every read returns empty and a write is dropped. The database holds at most its bound, and states how
 * many of the oldest quads it dropped to keep within it (CA4D13).
 */
import { matchesQuadPattern, type TQuad, type TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { DEVICE_STORES, META_KEY, QUAD_INDEX, type TDeviceDatabase, type TDeviceQuads, type TGraphSaturation } from "../ports.js";
import { done } from "./device-store.js";

/** A stored quad carries a derived `spg` (namedGraph|subject|predicate) key so `set`/`get` can upsert without a scan. */
type StoredQuad = TQuad & { spg: string };
const spgKey = (namedGraph: string, subject: string, predicate: string): string => `${namedGraph}|${subject}|${predicate}`;
const strip = ({ spg, ...quad }: StoredQuad): TQuad => quad;

/** What a read returns: the quads it read, or an empty list where the browser lacks IndexedDB, as the module states. */
const heldOrEmpty = (rows: TQuad[] | undefined): TQuad[] => (rows === undefined ? [] : rows);

/** The most quads a database of one actuality holds (CA4D13). A write past it drops the oldest quads by the time each was held. */
export const GRAPH_BOUND = 100_000;

export class IndexedDbQuads implements TDeviceQuads {
	readonly database: string;

	/** `db` holds the records of one actuality, and `bound` is the most quads it holds. */
	constructor(
		private readonly db: TDeviceDatabase,
		private readonly bound: number,
	) {
		this.database = db.name;
	}

	/** Run `fn` in one transaction over the quads, and resolve once it commits; `undefined` when IndexedDB is unavailable. */
	private withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T | undefined> {
		return this.db.within(mode, [DEVICE_STORES.QUADS], (tx) => fn(tx.objectStore(DEVICE_STORES.QUADS)));
	}

	/** Drops the oldest quads past the bound, and adds the count dropped to what the database states it dropped. */
	private async keepWithinBound(): Promise<void> {
		await this.db.within("readwrite", [DEVICE_STORES.QUADS, DEVICE_STORES.META], async (tx) => {
			const quads = tx.objectStore(DEVICE_STORES.QUADS);
			const over = (await done(quads.count())) - this.bound;
			if (over <= 0) return;
			let dropped = 0;
			await new Promise<void>((resolve, reject) => {
				const req = quads.index(QUAD_INDEX.TIME).openCursor();
				req.onsuccess = () => {
					const cursor = req.result;
					if (cursor === null || dropped >= over) return resolve();
					cursor.delete();
					dropped += 1;
					cursor.continue();
				};
				req.onerror = () => reject(req.error);
			});
			const meta = tx.objectStore(DEVICE_STORES.META);
			const before = await done(meta.get(META_KEY.DROPPED));
			meta.put((typeof before === "number" ? before : 0) + dropped, META_KEY.DROPPED);
		});
	}

	/** Returns how full the database's graph is: what it holds, its bound, and how many quads it dropped to stay within it. */
	async saturation(): Promise<TGraphSaturation> {
		const counted = await this.db.within("readonly", [DEVICE_STORES.QUADS, DEVICE_STORES.META], async (tx) => ({
			held: await done(tx.objectStore(DEVICE_STORES.QUADS).count()),
			dropped: await done(tx.objectStore(DEVICE_STORES.META).get(META_KEY.DROPPED)),
		}));
		if (counted === undefined) return { held: 0, bound: this.bound, dropped: 0 };
		return { held: counted.held, bound: this.bound, dropped: typeof counted.dropped === "number" ? counted.dropped : 0 };
	}

	async set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		const spg = spgKey(namedGraph, subject, predicate);
		await this.withStore("readwrite", async (store) => {
			for (const key of await done(store.index(QUAD_INDEX.SPG).getAllKeys(spg))) store.delete(key);
			store.add({ subject, predicate, object, namedGraph, timestamp: Date.now(), properties, spg } satisfies StoredQuad);
		});
		await this.keepWithinBound();
	}

	async get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		const matches = await this.query({ subject, predicate, namedGraph });
		return matches.length ? matches.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)).object : undefined;
	}

	async add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		await this.withStore("readwrite", (store) => {
			store.add({ ...quad, timestamp: Date.now(), spg: spgKey(quad.namedGraph, quad.subject, quad.predicate) } satisfies StoredQuad);
		});
		await this.keepWithinBound();
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		const rows = await this.withStore("readonly", async (store) => {
			// Narrow with the most selective index the pattern names, then filter the remaining fields. An object is an
			// index key where it names an individual (an id); any other value is matched after the widest read.
			const keyed = typeof pattern.object === "string" || typeof pattern.object === "number";
			const by: [string, IDBValidKey] | undefined =
				pattern.subject !== undefined
					? [QUAD_INDEX.SUBJECT, pattern.subject]
					: keyed
						? [QUAD_INDEX.OBJECT, pattern.object as IDBValidKey]
						: pattern.namedGraph !== undefined
							? [QUAD_INDEX.NAMED_GRAPH, pattern.namedGraph]
							: undefined;
			const indexed = by ? await done(store.index(by[0]).getAll(by[1])) : await done(store.getAll());
			return (indexed as StoredQuad[]).filter((q) => matchesQuadPattern(q, pattern)).map(strip);
		});
		return heldOrEmpty(rows);
	}

	async clear(namedGraph?: string): Promise<void> {
		await this.withStore("readwrite", async (store) => {
			if (namedGraph === undefined) {
				store.clear();
				return;
			}
			for (const key of await done(store.index(QUAD_INDEX.NAMED_GRAPH).getAllKeys(namedGraph))) store.delete(key);
		});
	}

	async remove(pattern: TQuadPattern): Promise<void> {
		await this.withStore("readwrite", async (store) => {
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
		const rows = await this.withStore("readonly", async (store) => ((await done(store.getAll())) as StoredQuad[]).map(strip));
		return heldOrEmpty(rows);
	}

	/** Hold each fact, replacing what is held under its subject, predicate and graph. A fact the device holds as it is
	 *  is not written again, and which it holds is found in a read, which doesn't hold back another reader: a page reloaded
	 *  over what it held otherwise rewrote every fact, and the device's other reads queued behind the rewrite. */
	async setMany(quads: TQuad[]): Promise<void> {
		const changed = await this.notHeld(quads);
		if (changed.length === 0) return;
		await this.withStore("readwrite", async (store) => {
			for (const quad of changed) {
				const spg = spgKey(quad.namedGraph, quad.subject, quad.predicate);
				for (const key of await done(store.index(QUAD_INDEX.SPG).getAllKeys(spg))) store.delete(key);
				store.add({ ...quad, spg } satisfies StoredQuad);
			}
		});
		await this.keepWithinBound();
	}

	/** The facts the device doesn't hold as they are: one it holds under the same subject, predicate and graph, with the
	 *  same object, is held, whenever it was held. Without IndexedDB a fact isn't held, and isn't written either. */
	private async notHeld(quads: TQuad[]): Promise<TQuad[]> {
		if (quads.length === 0) return [];
		const held = await this.withStore("readonly", (store) =>
			Promise.all(quads.map((quad) => done(store.index(QUAD_INDEX.SPG).getAll(spgKey(quad.namedGraph, quad.subject, quad.predicate))) as Promise<StoredQuad[]>)),
		);
		if (!held) return quads;
		// An object is compared as the JSON it is held as, so a record read back from the device compares as what was held.
		return quads.filter((quad, at) => {
			const stored = itemAt(held, at);
			return !(stored.length === 1 && JSON.stringify(itemAt(stored, 0).object) === JSON.stringify(quad.object));
		});
	}
}
