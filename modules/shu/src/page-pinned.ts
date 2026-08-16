/**
 * A page is more than one bundle: the app, a view a deployment adds, each built and loaded on its own, all over one
 * document. Some values belong to the page rather than to a bundle: what the site offers, what the site declares,
 * what a reader holds. This is the one way such a value is held, so every holder shares a key convention and a shape
 * instead of each bundle-crossing module hand-rolling its own.
 */
export function pagePinned<T>(key: string, make: () => T): T {
	const g = globalThis as unknown as Record<string, T | undefined>;
	return (g[key] ??= make());
}
