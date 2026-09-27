/**
 * A page is more than one bundle: the app, a view a deployment adds, each built and loaded on its own, all over one
 * document. Some values belong to the page rather than to a bundle: what the site offers, what the site declares,
 * what a reader holds. This is the one way such a value is held, so every holder shares a key convention and a shape
 * instead of each bundle-crossing module hand-rolling its own.
 */

/** A value the page holds, and how the page lets it go when it ends, where the value holds something to close. */
type TPinned = { value: unknown; release?: (value: unknown) => void };

const PAGE_KEY = "__SHU_PAGE__";
const pinned = (): Map<string, TPinned> => {
	const g = globalThis as unknown as Record<string, Map<string, TPinned> | undefined>;
	return (g[PAGE_KEY] ??= new Map());
};

export function pagePinned<T>(key: string, make: () => T, release?: (value: T) => void): T {
	const held = pinned().get(key);
	if (held) return held.value as T;
	const value = make();
	pinned().set(key, { value, release: release as TPinned["release"] });
	return value;
}

/** End the page: let go of every value it holds, so the next page makes each afresh. A browser ends a page by unloading
 *  its document; a test document stands in for one page after another, and ends each here. */
export function endPage(): void {
	const held = pinned();
	for (const { value, release } of held.values()) release?.(value);
	held.clear();
}
