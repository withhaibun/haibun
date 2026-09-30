/**
 * Which pages may frame shu, as the Content-Security-Policy of every page shu serves states it: this site's own, and the
 * embedding page's origin where the deployment names one. A page that embeds shu reads the same header to learn whether
 * it may.
 */

/** A Content-Security-Policy's source for the site's own pages. */
export const OWN_PAGES = "'self'";

/** The policy that lets this site's pages, and `embedderOrigin` where a deployment names one, frame shu. */
export const frameAncestors = (embedderOrigin: string | undefined): string => ["frame-ancestors", OWN_PAGES, ...(embedderOrigin ? [embedderOrigin] : [])].join(" ");

/** The sources a Content-Security-Policy lets frame a page, or undefined where the policy doesn't restrict framing. */
export function framingSources(policy: string | null): string[] | undefined {
	const directive = policy
		?.split(";")
		.map((part) => part.trim().split(/\s+/))
		.find(([name]) => name?.toLowerCase() === "frame-ancestors");
	return directive?.slice(1);
}

/** Whether a page at `origin` may frame a page served with `policy`. */
export function mayFrame(policy: string | null, origin: string): boolean {
	const sources = framingSources(policy);
	return sources === undefined || sources.includes("*") || sources.includes(origin);
}
