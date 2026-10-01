/**
 * Which pages may frame shu, as the Content-Security-Policy of every page shu serves states it: this site's own, and the
 * embedding page's origin where the deployment names one. A page that embeds shu reads the same header to learn whether
 * it may.
 */
import { MODULE_OPTION_PREFIX } from "@haibun/core/schema/protocol.js";

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** ShuStepper's option naming the embedding page's origin, as a page that can't frame shu states it to set. */
export const EMBEDDER_ORIGIN_OPTION = `${MODULE_OPTION_PREFIX}SHUSTEPPER_EMBEDDER_ORIGIN`;

/** The policy that lets this site's pages, and `embedderOrigin` where a deployment names one, frame shu. */
export const frameAncestors = (embedderOrigin: string | undefined): string => ["frame-ancestors", OWN_PAGES, ...(embedderOrigin ? [embedderOrigin] : [])].join(" ");

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
