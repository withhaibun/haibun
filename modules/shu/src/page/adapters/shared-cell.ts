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
	var __SHU_SHARED_CELLS__: Map<string, THeldCell<unknown>> | undefined;
}

/** Returns the map the page holds its cells in, made at the first call on the page. */
function cells(): Map<string, THeldCell<unknown>> {
	if (globalThis[SHARED_CELLS_KEY] === undefined) globalThis[SHARED_CELLS_KEY] = new Map();
	return globalThis[SHARED_CELLS_KEY];
}

/** A cell the page holds under its key, read and followed in every bundle. */
export class SharedCell<T> implements TSharedCell<T> {
	readonly #held: THeldCell<T>;
	constructor(key: string, initial: T) {
		const held = cells().get(key) as THeldCell<T> | undefined;
		this.#held = held === undefined ? { signal: new Signal.State<T>(initial), subs: new Set() } : held;
		if (held === undefined) cells().set(key, this.#held as THeldCell<unknown>);
	}
	get(): T {
		return this.#held.signal.get();
	}
	/** Sets the value, and calls each subscriber with it and the value it replaced. A value equal to the held one doesn't
	 *  call a subscriber, since each call draws the views that follow the cell again. */
	set(v: T): void {
		const before = this.#held.signal.get();
		if (before === v) return;
		this.#held.signal.set(v);
		for (const cb of this.#held.subs) cb(v, before);
	}
	subscribe(cb: (v: T, before: T) => void): () => void {
		this.#held.subs.add(cb);
		return () => this.#held.subs.delete(cb);
	}
}
