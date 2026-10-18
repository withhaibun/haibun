// A step action receives validated params and doesn't receive its request. The transport runs the dispatcher inside
// runWithRequestContext, so an action can read the request host through currentRequestBaseIri(). AsyncLocalStorage
// isolates the context per async chain.

import { AsyncLocalStorage } from "node:async_hooks";
import { haibunNsForHost } from "../../domains/resources.js";

type TRequestContext = { baseIri?: string };

const requestContext = new AsyncLocalStorage<TRequestContext>();

export function runWithRequestContext<T>(ctx: TRequestContext, fn: () => T): T {
	return requestContext.run(ctx, fn);
}

export function currentRequestBaseIri(): string | undefined {
	return requestContext.getStore()?.baseIri;
}

/** Returns the haibun namespace for the current request's host from the request context. Outside a request it returns the canonical stem. */
export function requestHaibunNs(): string {
	return haibunNsForHost(currentRequestBaseIri());
}

type TRequestHeaders = Record<string, string | undefined>;

/** The scheme of a request that a proxy didn't forward: one that reached the server directly, over plain HTTP. */
const UNFORWARDED_SCHEME = "http";

const firstOf = (value?: string): string | undefined => value?.split(",")[0]?.trim() || undefined;

/** Returns the host that received a request. It reads the host a reverse proxy forwards, else the request's own Host header.
 *  A caller that reaches the server directly can write either header, so the value doesn't prove the request's origin. */
const requestHost = (headers: TRequestHeaders): string | undefined => firstOf(headers["x-forwarded-host"]) ?? firstOf(headers.host);

/** Returns the absolute origin (scheme://host[:port]) a request arrived on, read from its host and forwarding headers.
 *  Returns undefined when a host header isn't present. */
export function requestBaseIri(headers?: TRequestHeaders): string | undefined {
	const host = headers && requestHost(headers);
	if (!headers || !host) return undefined;
	const forwarded = firstOf(headers["x-forwarded-proto"]);
	return `${forwarded === undefined ? UNFORWARDED_SCHEME : forwarded}://${host}`;
}

/** Returns whether a browser sent this request for a page of another site. Such a request states an `Origin` whose host
 *  isn't the host the request arrived on, or an `Origin` that doesn't parse. A request that doesn't state an `Origin`
 *  wasn't sent across sites by a browser. A browser doesn't let a page write the host or forwarding headers. */
export function sentByAnotherSite(headers?: TRequestHeaders): boolean {
	const origin = headers?.origin;
	if (!headers || origin === undefined) return false;
	return !URL.canParse(origin) || new URL(origin).host !== requestHost(headers);
}
