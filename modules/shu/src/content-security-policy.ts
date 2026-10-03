/**
 * The Content-Security-Policy of every page shu serves. It states which pages may frame shu: this site's own, and the
 * embedding page's origin where the deployment names one. A page that embeds shu reads the same header to learn whether
 * it may. It states which scripts run, so a document a page opens with its own origin, as a file a sender chose the type
 * of, runs none of its own.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/schema/protocol.js";

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option naming the embedding page's origin, as a page that can't frame shu states it to set. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;

/** The policy that lets this site's pages, and `embedderOrigin` where a deployment names one, frame shu. */
export const frameAncestors = (embedderOrigin: string | undefined): string => ["frame-ancestors", OWN_PAGES, ...(embedderOrigin ? [embedderOrigin] : [])].join(" ");

/**
 * The scripts a page runs, each source for what needs it: the script shu serves with the page, which carries the
 * response's nonce, and what that script loads (`'strict-dynamic'`), as each component a concern declares by its `ui.js`;
 * code the 3D graph's layout library builds from text (`'unsafe-eval'`); and WebAssembly, which the voice assistant's
 * speech model compiles (`'wasm-unsafe-eval'`). An inline script without the nonce, an event handler attribute, and a
 * script a page adds other than by loading it from a script that runs, don't run: the page reports each it refuses
 * (`reportRefusedScripts`).
 */
export const scriptSources = (nonce: string): string => ["script-src", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-eval'", "'wasm-unsafe-eval'"].join(" ");

/** The policy a page shu serves states: which pages may frame it, and which scripts it runs. */
export const pagePolicy = (embedderOrigin: string | undefined, nonce: string): string => [frameAncestors(embedderOrigin), scriptSources(nonce)].join("; ");

/** The sources each policy of a Content-Security-Policy header lets frame a page, for the policies that restrict framing.
 *  A header that carries several policies, as a proxy that adds its own sends, joins them with commas. */
export function framingSources(header: string | null): string[][] {
	return (header ?? "").split(",").flatMap((policy) => {
		const directive = policy
			.split(";")
			.map((part) => part.trim().split(/\s+/))
			.find(([name]) => name?.toLowerCase() === "frame-ancestors");
		return directive ? [directive.slice(1)] : [];
	});
}

/** Whether a page at `origin` may frame a page served with `header`: every policy that restricts framing names it, or any origin. */
export function mayFrame(header: string | null, origin: string): boolean {
	return framingSources(header).every((sources) => sources.includes("*") || sources.includes(origin));
}
