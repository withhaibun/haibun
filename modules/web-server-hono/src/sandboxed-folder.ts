import type { MiddlewareHandler } from "hono";

/** The headers a response carries so the page it opens as can't run a script, and its bytes aren't read as another type. */
export const SANDBOXED_HEADERS = { "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" } as const;

/**
 * A middleware that serves what is under a folder named `folder` sandboxed. A file a person adds can be a page that
 * holds a script, and served from this site it would run with a reader's authority here; sandboxed, it opens as a page
 * of its own origin that doesn't run one, and an image still shows where a page names it.
 */
export const servedSandboxed =
	(folder: string): MiddlewareHandler =>
	async (c, next) => {
		await next();
		if (!c.req.path.split("/").includes(folder)) return;
		for (const [name, value] of Object.entries(SANDBOXED_HEADERS)) c.res.headers.set(name, value);
	};
