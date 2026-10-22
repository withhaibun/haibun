/**
 * The quads one actuality's database holds on the device. A quad observation is an upsert by subject, predicate and named
 * graph, so the database holds one row per fact rather than a row per update. Without IndexedDB (a report, or a context
 * without it) every read returns empty and a write is dropped. The database holds at most its bound, and states how
 * many of the oldest quads it dropped to keep within it (CA4D13).
 */
import { matchesQuadPattern, type TQuad, type TQuadPattern } from "@haibun/core/lib/quad-types.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
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

/** The rows a database holds under a quad's subject, predicate and graph: their keys, and the rows. */
type THeld = { keys: IDBValidKey[]; rows: StoredQuad[] };

export class IndexedDbQuads implements TDeviceQuads {
	readonly database: string;

	/** `db` holds the records of one actuality, and `bound` is the most quads it holds. */
	constructor(
		private readonly db: TDeviceDatabase,
		private readonly bound: number,
	) {
		this.database = db.name;
	}

	/** Reads the quads in one transaction; `undefined` when IndexedDB is unavailable. */
	private read<T>(fn: (store: IDBObjectStore) => Promise<T>): Promise<T | undefined> {
		return this.db.within("readonly", [DEVICE_STORES.QUADS], (tx) => fn(tx.objectStore(DEVICE_STORES.QUADS)));
	}

	/** Writes the quads in one transaction, whose requests `fn` issues without awaiting a result. */
	private async write(fn: (store: IDBObjectStore) => void): Promise<void> {
		await this.db.within("readwrite", [DEVICE_STORES.QUADS], (tx) => fn(tx.objectStore(DEVICE_STORES.QUADS)));
	}

	/** The rows the database holds under each quad's subject, predicate and graph, read in one transaction. */
	private held(quads: readonly Omit<TQuad, "timestamp">[]): Promise<THeld[] | undefined> {
		return this.read((store) =>
			Promise.all(
				quads.map(async ({ namedGraph, subject, predicate }) => {
					const index = store.index(QUAD_INDEX.SPG);
					const spg = spgKey(namedGraph, subject, predicate);
					const [keys, rows] = await Promise.all([done(index.getAllKeys(spg)), done(index.getAll(spg))]);
					return { keys, rows: rows as StoredQuad[] };
				}),
			),
		);
	}

	/** Holds each of `quads` that `writes` selects in place of the rows held under its subject, predicate and graph, and drops
	 *  the oldest quads past the bound. Without IndexedDB, the quads drop. */
	private async replace(quads: readonly TQuad[], writes: (quad: TQuad, held: THeld) => boolean): Promise<void> {
		if (quads.length === 0) return;
		const held = await this.held(quads);
		if (held === undefined) return;
		const changed = quads.flatMap((quad, at) => (writes(quad, itemAt(held, at)) ? [{ quad, keys: itemAt(held, at).keys }] : []));
		if (changed.length === 0) return;
		await this.write((store) => {
			for (const { quad, keys } of changed) {
				for (const key of keys) store.delete(key);
				store.add({ ...quad, spg: spgKey(quad.namedGraph, quad.subject, quad.predicate) } satisfies StoredQuad);
			}
		});
		await this.keepWithinBound();
	}

	/** The latest pass that keeps the bound. The next pass starts once it ends, so two of this page's writes don't drop the same
	 *  quads and count them twice. */
	private bounded: Promise<void> = Promise.resolve();

	/** Drops the oldest quads past the bound, and adds the count dropped to what the database states it dropped. */
	private keepWithinBound(): Promise<void> {
		const pass = async (): Promise<void> => {
			const { held, dropped } = await this.saturation();
			const excess = held - this.bound;
			if (excess <= 0) return;
			const oldest = await this.read((store) => done(store.index(QUAD_INDEX.TIME).getAllKeys(null, excess)));
			if (oldest === undefined) return;
			await this.db.within("readwrite", [DEVICE_STORES.QUADS, DEVICE_STORES.META], (tx) => {
				for (const key of oldest) tx.objectStore(DEVICE_STORES.QUADS).delete(key);
				tx.objectStore(DEVICE_STORES.META).put(dropped + oldest.length, META_KEY.DROPPED);
			});
		};
		// A pass starts whether the one before it held or failed: a failure reaches the caller of its own pass.
		this.bounded = this.bounded.then(pass, pass);
		return this.bounded;
	}

	/** Returns how full the database's graph is: what it holds, its bound, and how many quads it dropped to stay within it. */
	async saturation(): Promise<TGraphSaturation> {
		const counted = await this.db.within("readonly", [DEVICE_STORES.QUADS, DEVICE_STORES.META], (tx) =>
			Promise.all([done(tx.objectStore(DEVICE_STORES.QUADS).count()), done(tx.objectStore(DEVICE_STORES.META).get(META_KEY.DROPPED))]),
		);
		if (counted === undefined) return { held: 0, bound: this.bound, dropped: 0 };
		const [held, dropped] = counted;
		return { held, bound: this.bound, dropped: typeof dropped === "number" ? dropped : 0 };
	}

	set(subject: string, predicate: string, object: unknown, namedGraph: string, properties?: Record<string, unknown>): Promise<void> {
		return this.replace([{ subject, predicate, object, namedGraph, timestamp: Date.now(), properties }], () => true);
	}

	async get(subject: string, predicate: string, namedGraph?: string): Promise<unknown | undefined> {
		const matches = await this.query({ subject, predicate, namedGraph });
		return matches.length ? matches.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)).object : undefined;
	}

	async add(quad: Omit<TQuad, "timestamp">): Promise<void> {
		await this.write((store) => {
			store.add({ ...quad, timestamp: Date.now(), spg: spgKey(quad.namedGraph, quad.subject, quad.predicate) } satisfies StoredQuad);
		});
		await this.keepWithinBound();
	}

	async query(pattern: TQuadPattern): Promise<TQuad[]> {
		const rows = await this.read(async (store) => {
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
		if (namedGraph === undefined) return this.write((store) => store.clear());
		const keys = await this.read((store) => done(store.index(QUAD_INDEX.NAMED_GRAPH).getAllKeys(namedGraph)));
		if (keys !== undefined) await this.write((store) => keys.forEach((key) => store.delete(key)));
	}

	async remove(pattern: TQuadPattern): Promise<void> {
		const matching = await this.read(async (store) => {
			const [keys, rows] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
			return keys.filter((_, at) => matchesQuadPattern(itemAt(rows as StoredQuad[], at), pattern));
		});
		if (matching !== undefined) await this.write((store) => matching.forEach((key) => store.delete(key)));
	}

	async all(): Promise<TQuad[]> {
		const rows = await this.read(async (store) => ((await done(store.getAll())) as StoredQuad[]).map(strip));
		return heldOrEmpty(rows);
	}

	/** Hold each fact, replacing what is held under its subject, predicate and graph. A fact the device holds as it is isn't
	 *  written again: an object is compared as the JSON it is held as, so a record read back from the device compares as what
	 *  was held, whenever it was held. A page reloaded over what it held otherwise rewrote every fact, and the device's other
	 *  reads queued behind the rewrite. */
	setMany(quads: TQuad[]): Promise<void> {
		return this.replace(quads, (quad, { rows }) => !(rows.length === 1 && JSON.stringify(itemAt(rows, 0).object) === JSON.stringify(quad.object)));
	}
}
