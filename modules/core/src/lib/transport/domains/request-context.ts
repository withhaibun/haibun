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

/** Returns the origin among `origins` whose host, with its port, is `host`, the host a request names. */
export const namedOrigin = (origins: readonly string[], host: string | undefined): string | undefined =>
	host === undefined ? undefined : origins.find((origin) => new URL(origin).host === host);

/**
 * Returns the absolute origin (scheme://host[:port]) that received a request. A configured origin is that origin where the
 * host a reverse proxy forwards names it, or else where the request's Host header names it, with the scheme the origin states. A
 * forwarded host that doesn't name a configured origin is ignored, since a caller that reaches the server directly can write
 * it. A request addressed to a host outside the configured origins, such as a loopback name in development, arrived over plain HTTP at
 * that host. Returns undefined where the request doesn't state a Host.
 */
export function requestBaseIri(headers: TRequestHeaders | undefined, origins: readonly string[]): string | undefined {
	const host = firstOf(headers?.host);
	const reached = namedOrigin(origins, firstOf(headers?.["x-forwarded-host"])) ?? namedOrigin(origins, host);
	if (reached !== undefined) return reached;
	return host === undefined ? undefined : `${UNFORWARDED_SCHEME}://${host}`;
}

/** Returns whether a browser sent this request for a page of another site. Such a request states an `Origin` whose host
 *  isn't the host of the origin the request arrived on, or an `Origin` that doesn't parse. A request that doesn't state an
 *  `Origin` wasn't sent across sites by a browser. A browser doesn't let a page write the host or forwarding headers. */
export function sentByAnotherSite(headers: TRequestHeaders | undefined, origins: readonly string[]): boolean {
	const origin = headers?.origin;
	if (origin === undefined) return false;
	const arrived = requestBaseIri(headers, origins);
	return !URL.canParse(origin) || arrived === undefined || new URL(origin).host !== new URL(arrived).host;
}
