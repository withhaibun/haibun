// A step action gets validated params, not its request. The transport runs the dispatcher inside runWithRequestContext
// so an action can read the request host via currentRequestBaseIri(); AsyncLocalStorage isolates it per async chain.

import { AsyncLocalStorage } from "node:async_hooks";
import { haibunNsForHost } from "./resources.js";

type TRequestContext = { baseIri?: string };

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

type TRequestHeaders = Record<string, string | undefined>;

const firstOf = (value?: string): string | undefined => value?.split(",")[0]?.trim() || undefined;

/** The host a request arrived on: the one a reverse proxy forwards, else its own Host header. A caller that reaches the
 *  server directly writes either header, so neither is read as proof of anything. */
const requestHost = (headers: TRequestHeaders): string | undefined => firstOf(headers["x-forwarded-host"]) ?? firstOf(headers.host);

/** The absolute origin (scheme://host[:port]) a request arrived on, from its host and forwarding headers. Undefined when
 *  a host header isn't present. */
export function requestBaseIri(headers?: TRequestHeaders): string | undefined {
	const host = headers && requestHost(headers);
	if (!headers || !host) return undefined;
	return `${firstOf(headers["x-forwarded-proto"]) ?? "http"}://${host}`;
}

/** Whether a browser sent this request for a page of another site: it states an `Origin` whose host isn't the host the
 *  request arrived on. A request that doesn't state an `Origin` wasn't sent across sites by a browser, and a browser
 *  doesn't let a page write the host or forwarding headers. */
export function sentByAnotherSite(headers?: TRequestHeaders): boolean {
	const origin = headers?.origin;
	if (!headers || origin === undefined) return false;
	return !URL.canParse(origin) || new URL(origin).host !== requestHost(headers);
}
