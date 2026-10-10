/**
 * The Content-Security-Policy of every page shu serves. It states which pages may frame shu: this site's own pages, and
 * the embedding page's origin where the deployment names one. A page that embeds shu reads the same header to determine
 * whether it may frame shu. The policy also states which scripts run. A document doesn't run its own scripts when a page
 * opens it with the page's origin, as with a file whose type a sender chose.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/schema/protocol.js";

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option that names the embedding page's origin. A page that can't frame shu names this option as the setting to change. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;

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

/** The sandbox flags of an artifact a step saved, wherever the artifact is shown. An artifact can hold the page a step
 *  checked, so it doesn't run a script or access an origin. It can open a link in a tab of its own. A frame states these
 *  flags as its sandbox. */
export const ARTIFACT_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/** The policy every artifact is served with. An artifact opened by its address doesn't run a script on this site's origin. */
export const ARTIFACT_POLICY = `sandbox ${ARTIFACT_SANDBOX}`;

/** The policy of a page shu serves: which pages may frame it, and which scripts it runs. */
export const pagePolicy = (embedderOrigin: string | undefined, nonce: string): string => [frameAncestors(embedderOrigin), scriptSources(nonce)].join("; ");

/** Returns the frame-ancestors sources of each policy in a Content-Security-Policy header that restricts framing. A header
 *  that carries several policies joins them with commas. A proxy that adds its own policy sends such a header. */
export function framingSources(header: string | null): string[][] {
	return (header ?? "").split(",").flatMap((policy) => {
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
