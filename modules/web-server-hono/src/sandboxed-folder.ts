import type { MiddlewareHandler } from "hono";

/** The headers that sandbox a response: a browser opens it as a page that doesn't run a script, and doesn't read its
 *  bytes as another media type. */
/** The header whose sandbox value keeps a page a response opens as from running a script. */
export const SANDBOX_HEADER = "Content-Security-Policy";

export const SANDBOXED_HEADERS = { [SANDBOX_HEADER]: "sandbox", "X-Content-Type-Options": "nosniff" } as const;

/**
 * Set SANDBOXED_HEADERS on each response whose path has a segment named `folder`. A file a person adds can be a page
 * that holds a script. Served from this origin without the sandbox, the script would run with the reader's authority.
 * An image still shows where a page names it.
 */
export const servedSandboxed =
	(folder: string): MiddlewareHandler =>
	async (c, next) => {
		await next();
		if (!c.req.path.split("/").includes(folder)) return;
		for (const [name, value] of Object.entries(SANDBOXED_HEADERS)) c.res.headers.set(name, value);
	};
