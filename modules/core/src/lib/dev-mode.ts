/**
 * dev-mode — runtime DEV vs PROD switch and the `failFastOrLog` helper that
 * sits on top of it.
 *
 * Some code paths must catch errors that would otherwise interrupt unrelated
 * work — a thrown listener cannot be allowed to silence its siblings, for
 * example. Logging that caught error to the console is the prod-time fallback,
 * but the browser console is easy to miss and silent failures hide bugs.
 *
 * `failFastOrLog` resolves that tension: in DEV the error is re-thrown so the
 * developer sees the failure immediately; in PROD it is logged and execution
 * continues. Callers wrap whatever they're protecting in the usual try/catch
 * and call this helper from inside the catch.
 *
 * Detection
 *   - Node: `process.env.NODE_ENV !== "production"`.
 *   - Browser: defaults to DEV. A bundler can pin the page to PROD by setting
 *     `globalThis.__HAIBUN_PROD__ = true` at build time, or callers can pin
 *     the value at startup via `setDevMode()`.
 */

declare global {
	// biome-ignore lint/style/noVar: declare global needs var.
	var __HAIBUN_PROD__: boolean | undefined;
}

let cached: boolean | null = null;

export function isDev(): boolean {
	if (cached !== null) return cached;
	if (typeof process !== "undefined" && process.env && typeof process.env.NODE_ENV === "string") {
		cached = process.env.NODE_ENV !== "production";
		return cached;
	}
	cached = globalThis.__HAIBUN_PROD__ !== true;
	return cached;
}

/** Pin the DEV/PROD flag. Useful for tests or for an app that wants explicit control. */
export function setDevMode(value: boolean): void {
	cached = value;
}

/** Drop the cached determination so the next `isDev()` re-evaluates. */
export function resetDevModeCache(): void {
	cached = null;
}

/**
 * Inside a catch: re-throw in DEV (surface the bug), log + continue in PROD
 * (one bad caller must not silence the rest). Always pass `err` from the
 * surrounding catch — the throw needs to carry the original failure.
 */
export function failFastOrLog(label: string, err: unknown): void {
	if (isDev()) throw err;
	console.error(label, err);
}
