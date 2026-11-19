/**
 * What the page holds by key, across its bundles. A page loads more than one bundle over one document (the app, a view a
 * deployment adds), and each bundle holds its own copy of each module, so a value of the page (a port, the reader's
 * authority) is held on the page by key, and every bundle's copy reads the one value. The module doesn't import another
 * module, so the browser extension's background, a worker that doesn't hold a document, loads it.
 */

declare global {
	/** The values the page holds, by key. Each module that holds a value declares its key and the value's type here, so every
	 *  bundle reads a key's value with one type, and a key declared with two types doesn't compile. */
	interface TShuPageValues {}
	var __SHU_PAGE__: TPinned | undefined;
}

/** The values the page holds, and how the page lets each go when it ends, where the value holds something to close. */
type TPinned = { values: Partial<TShuPageValues>; releases: Map<keyof TShuPageValues, () => void> };

/** The key of the page's values. */
const PAGE_KEY = "__SHU_PAGE__";

/** What a page holds before it holds a value. */
const emptyPage = (): TPinned => ({ values: {}, releases: new Map() });

/** Returns what the page holds its values in, made at the first call on the page. */
function pinned(): TPinned {
	globalThis[PAGE_KEY] ??= emptyPage();
	return globalThis[PAGE_KEY];
}

/** Returns the value the page holds under `key`, made by `make` where the page doesn't hold one. `release` lets the value
 *  go when the page ends. */
export function pagePinned<K extends keyof TShuPageValues>(key: K, make: () => TShuPageValues[K], release?: (value: TShuPageValues[K]) => void): TShuPageValues[K] {
	const { values, releases } = pinned();
	const held = values[key];
	if (held !== undefined) return held;
	const value = make();
	values[key] = value;
	if (release !== undefined) releases.set(key, () => release(value));
	return value;
}

/** Ends the page: lets go of every value it holds, so the next page makes each again. A browser ends a page by unloading
 *  its document, and a test document stands in for one page after another, and ends each here. A cell outlasts the page,
 *  since a module holds it from its load. */
export function endPage(): void {
	for (const release of pinned().releases.values()) release();
	globalThis[PAGE_KEY] = emptyPage();
}

/** Returns a load of what `load` loads, made at its first call and held for each call after it: a module a page rarely
 *  needs loads where it is first used. Within a single-file bundle the module is already present, and the load resolves
 *  without a fetch. */
export function loadedOnFirstUse<T>(load: () => Promise<T>): () => Promise<T> {
	let loaded: Promise<T> | undefined;
	return () => {
		loaded ??= load();
		return loaded;
	};
}
