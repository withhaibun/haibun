/**
 * The Content-Security-Policy of every page shu serves. It states which pages may frame shu: this site's own pages, and
 * the embedding page's origin where the deployment names one. A page that embeds shu reads the same header to determine
 * whether it may frame shu. The policy also states which scripts run. A document doesn't run its own scripts when a page
 * opens it with the page's origin, as with a file whose type a sender chose.
 */
import { OWN_PAGES } from "../domains/serving.js";

/** The frame-ancestors policy. It lets this site's pages frame shu, and `embedderOrigin` where a deployment names one. */
export const frameAncestors = (embedderOrigin: string | undefined): string => ["frame-ancestors", OWN_PAGES, ...(embedderOrigin ? [embedderOrigin] : [])].join(" ");

/**
 * The script-src policy, with one source for each kind of script a page runs. The script shu serves with the page carries
 * the response's nonce. A script loaded by that script runs under `'strict-dynamic'`, as does each component a concern
 * declares by its `ui.js`. The 3D graph's layout library builds code from text under `'unsafe-eval'`. The voice assistant's speech
 * model compiles WebAssembly under `'wasm-unsafe-eval'`. The browser blocks an inline script without the nonce, an event
 * handler attribute, and a script a page adds other than by loading it from a running script. The page reports each
 * blocked script (`reportRefusedScripts` in `page/pipelines/page-observations.ts`).
 */
export const scriptSources = (nonce: string): string => ["script-src", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-eval'", "'wasm-unsafe-eval'"].join(" ");

/** The policy of a page shu serves: which pages may frame it, and which scripts it runs. */
export const pagePolicy = (embedderOrigin: string | undefined, nonce: string): string => [frameAncestors(embedderOrigin), scriptSources(nonce)].join("; ");

/** Returns the frame-ancestors sources of each policy in a Content-Security-Policy header that restricts framing. A header
 *  that carries several policies joins them with commas. A proxy that adds its own policy sends such a header. */
export function framingSources(header: string | null): string[][] {
	if (header === null) return [];
	return header.split(",").flatMap((policy) => {
		const directive = policy
			.split(";")
			.map((part) => part.trim().split(/\s+/))
			.find(([name]) => name?.toLowerCase() === "frame-ancestors");
		return directive ? [directive.slice(1)] : [];
	});
}

/** Whether a page at `origin` may frame a page served with `header`. Every policy that restricts framing must name `origin` or `*`. */
export function mayFrame(header: string | null, origin: string): boolean {
	return framingSources(header).every((sources) => sources.includes("*") || sources.includes(origin));
}
