/**
 * The page's cells. A cell pairs a `Signal.State`, which a Lit render in the bundle that reads it follows, with a set of
 * subscribers, which reach every bundle. The signal polyfill holds its tracking context in each bundle's copy of the
 * module, so a view in another bundle follows a cell through `subscribe` alone. `set` updates both. The page holds each
 * cell under its key, across its bundles.
 */
import { Signal } from "@lit-labs/signals";
import type { TSharedCell } from "../ports.js";

/** A cell's signal and its subscribers. */
type THeldCell<T> = { signal: Signal.State<T>; subs: Set<(v: T, before: T) => void> };

/** The key of the page's cells. A page reader outside the bundles finds the cells under it. */
export const SHARED_CELLS_KEY = "__SHU_SHARED_CELLS__";

declare global {
	/** The values of the page's cells, by key. Each module that makes a cell declares its key and the value's type here, so
	 *  every bundle reads a cell with one type, and a key declared with two types doesn't compile. */
	interface TShuPageCells {}
	var __SHU_SHARED_CELLS__: THeldCells | undefined;
}

/** The page's cells, each under its key. */
type THeldCells = { [K in keyof TShuPageCells]?: THeldCell<TShuPageCells[K]> };

/** Returns the page's cells, made at the first call on the page. */
function cells(): THeldCells {
	if (globalThis[SHARED_CELLS_KEY] === undefined) globalThis[SHARED_CELLS_KEY] = {};
	return globalThis[SHARED_CELLS_KEY];
}

/** Holds `cell` among the page's cells under `key`, and returns it. */
function held<K extends keyof TShuPageCells>(page: { [P in K]?: THeldCell<TShuPageCells[P]> }, key: K, cell: THeldCell<TShuPageCells[K]>): THeldCell<TShuPageCells[K]> {
	page[key] = cell;
	return cell;
}

/** A cell the page holds under its key, read and followed in every bundle. */
export class SharedCell<K extends keyof TShuPageCells> implements TSharedCell<TShuPageCells[K]> {
	readonly #held: THeldCell<TShuPageCells[K]>;
	constructor(key: K, initial: TShuPageCells[K]) {
		const page = cells();
		this.#held = page[key] ?? held(page, key, { signal: new Signal.State(initial), subs: new Set() });
	}
	get(): TShuPageCells[K] {
		return this.#held.signal.get();
	}
	/** Sets the value, and calls each subscriber with it and the value it replaced. A value equal to the held one doesn't
	 *  call a subscriber, since each call draws the views that follow the cell again. */
	set(v: TShuPageCells[K]): void {
		const before = this.#held.signal.get();
		if (before === v) return;
		this.#held.signal.set(v);
		for (const cb of this.#held.subs) cb(v, before);
	}
	subscribe(cb: (v: TShuPageCells[K], before: TShuPageCells[K]) => void): () => void {
		this.#held.subs.add(cb);
		return () => this.#held.subs.delete(cb);
	}
}
