/**
 * dev-mode: the switch between development and production, as Node's convention states it, and the `failFastOrLog` helper that
 * depends on it. `NODE_ENV=production` selects production, and every other value selects development, as an unset NODE_ENV does.
 * A browser bundle reads the NODE_ENV of its build, which esbuild's `define` carries into it.
 *
 * Some code paths catch an error so that it doesn't interrupt unrelated work. For example, a listener that throws must not stop
 * the other listeners. `failFastOrLog` throws the error again in development, so the developer sees the failure at once. In
 * production it logs the error, and the code after the catch runs, so the process keeps serving. A caller wraps the isolated code
 * in a try/catch and calls this helper in the catch.
 */

/** The value of NODE_ENV that selects production. */
export const PRODUCTION = "production";

/** Whether the process runs in development: every NODE_ENV but production. */
export const isDev = (): boolean => process.env.NODE_ENV !== PRODUCTION;

/**
 * Called inside a catch. Throws `err` again in development, so the developer sees the failure. Logs `label` and `err` in
 * production and returns, so the caller continues. Pass the `err` of the surrounding catch, so the error thrown is the original.
 */
export function failFastOrLog(label: string, err: unknown): void {
	if (isDev()) throw err;
	console.error(label, err);
}
