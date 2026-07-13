// A step action gets validated params, not its request. The transport runs the dispatcher inside runWithRequestContext
// so an action can read the request host via currentRequestBaseIri(); AsyncLocalStorage isolates it per async chain.

import { AsyncLocalStorage } from "node:async_hooks";
import { haibunNsForHost } from "./resources.js";

export type TRequestContext = { baseIri?: string };

const requestContext = new AsyncLocalStorage<TRequestContext>();

export function runWithRequestContext<T>(ctx: TRequestContext, fn: () => T): T {
	return requestContext.run(ctx, fn);
}

export function currentRequestBaseIri(): string | undefined {
	return requestContext.getStore()?.baseIri;
}

/** The haibun namespace for the current request's host (out of the request context), or the canonical stem when off-request. */
export function requestHaibunNs(): string {
	return haibunNsForHost(currentRequestBaseIri());
}

/** The absolute origin (scheme://host[:port]) a request arrived on, from its host / forwarding headers (honoring a
 *  reverse proxy). Undefined when no host header is present. */
export function requestBaseIri(headers?: Record<string, string | undefined>): string | undefined {
	if (!headers) return undefined;
	const first = (v?: string): string | undefined => v?.split(",")[0]?.trim() || undefined;
	const host = first(headers["x-forwarded-host"]) ?? first(headers["host"]);
	if (!host) return undefined;
	const proto = first(headers["x-forwarded-proto"]) ?? "http";
	return `${proto}://${host}`;
}
