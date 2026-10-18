/**
 * dev-mode: the runtime switch between DEV and PROD, and the `failFastOrLog` helper that depends on it.
 *
 * Some code paths catch an error so that it doesn't interrupt unrelated work. For example, a listener that throws must
 * not stop the other listeners. In PROD the caught error is logged to the console. A person can miss an error in a
 * browser console, and the bug then stays unfixed.
 *
 * `failFastOrLog` re-throws the error in DEV, so the developer sees the failure immediately. In PROD it logs the error,
 * and execution continues. A caller wraps the protected code in a try/catch and calls this helper in the catch.
 *
 * Detection
 *   - Where `process.env.NODE_ENV` is set: DEV unless it is "production".
 *   - Elsewhere, such as a browser: DEV unless a bundler sets `globalThis.__HAIBUN_PROD__ = true` at build time.
 */

declare global {
	var __HAIBUN_PROD__: boolean | undefined;
}

export function isDev(): boolean {
	if (typeof process !== "undefined" && process.env && typeof process.env.NODE_ENV === "string") return process.env.NODE_ENV !== "production";
	return globalThis.__HAIBUN_PROD__ !== true;
}

/**
 * Called inside a catch. Re-throws `err` in DEV, so the developer sees the failure. Logs `label` and `err` in PROD and
 * returns, so the caller continues. Pass the `err` of the surrounding catch, so the re-thrown error is the original failure.
 */
export function failFastOrLog(label: string, err: unknown): void {
	if (isDev()) throw err;
	console.error(label, err);
}
