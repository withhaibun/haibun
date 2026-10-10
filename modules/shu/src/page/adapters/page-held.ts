/**
 * What the page holds by key, across its bundles. A page loads more than one bundle over one document (the app, a view a
 * deployment adds), and each bundle holds its own copy of each module, so a value of the page (a port, the reader's
 * authority) is held on the page by key, and every bundle's copy reads the one value. The module doesn't import another
 * module, so the browser extension's background, a worker that doesn't hold a document, loads it.
 */

/** A value the page holds, and how the page lets it go when it ends, where the value holds something to close. */
type TPinned = { value: unknown; release?: (value: unknown) => void };

/** The key of the page's values. */
const PAGE_KEY = "__SHU_PAGE__";

declare global {
	var __SHU_PAGE__: Map<string, TPinned> | undefined;
}

/** Returns the map the page holds its values in, made at the first call on the page. */
function pinned(): Map<string, TPinned> {
	if (globalThis[PAGE_KEY] === undefined) globalThis[PAGE_KEY] = new Map();
	return globalThis[PAGE_KEY];
}

/** Returns the value the page holds under `key`, made by `make` where the page doesn't hold one. `release` lets the value
 *  go when the page ends. */
export function pagePinned<T>(key: string, make: () => T, release?: (value: T) => void): T {
	const held = pinned().get(key);
	if (held) return held.value as T;
	const value = make();
	pinned().set(key, { value, release: release as TPinned["release"] });
	return value;
}

/** Ends the page: lets go of every value it holds, so the next page makes each again. A browser ends a page by unloading
 *  its document, and a test document stands in for one page after another, and ends each here. A cell outlasts the page,
 *  since a module holds it from its load. */
export function endPage(): void {
	const held = pinned();
	for (const { value, release } of held.values()) release?.(value);
	held.clear();
}
