/**
 * Shared HTTP observation types and helpers.
 *
 * Used by any stepper that tracks HTTP activity, including:
 * - NodeHttpEvents (Node.js fetch/undici requests)
 * - PlaywrightEvents (browser requests via Playwright)
 */

import type { TWorld } from "./world.js";
import { LinkRelations } from "./resources.js";
import { activeSitePrincipal } from "./host-id.js";
import { OBSERVATION_GRAPH as WORKING_MEMORY_GRAPH, assertFact, getFact } from "./working-memory.js";

/** The one type every observed HTTP request becomes: the single network-interaction record. Its `performedBy`/`target`
 *  edges make it a message on the fisheye sequence view. */
export const HTTP_REQUEST_LABEL = "HttpRequest";
/** The lifelines a request runs between: the calling client and external hosts (the site is the existing Principal node). */
export const HTTP_AGENT_LABEL = "HttpAgent";
/** The singleton client lifeline: the browser / user agent that calls the site's routes and external resources. */
const CLIENT_ID = "client";
/** The endpoint class a request hit, a property on the one record (route = the site's own page, service = its /rpc or
 *  /sse plumbing, external = another host), so class reads in the detail without a graph per class. */
const ENDPOINT_CLASS: Record<string, string> = { "observation/route": "route", "observation/shu-service": "service", "observation/external": "external" };

/** Who made an observed request: the `client` (browser / user agent) for requests the site RECEIVES, or the `site`
 *  itself for requests it MAKES outbound. Fixes the sequence message's source lifeline so it reads with true direction. */
export type THttpOrigin = "client" | "site";

/** The external host a request went to (an own-route path has no host), for the destination lifeline of an outbound message. */
function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname || undefined;
	} catch {
		return undefined;
	}
}

export const SERVICE_PATH_PREFIXES = ["/sse", "/rpc/"] as const;

export const OBSERVATION_GRAPH = { ROUTE: "observation/route", SERVICE: "observation/shu-service", EXTERNAL: "observation/external", ENDPOINT: "Endpoint" } as const;

/** Classify an HTTP path against registered route paths. Returns the observation namedGraph and resolved endpoint path. */
export function classifyHttpPath(path: string, registeredPaths: Set<string>): { namedGraph: string; endpointPath: string } {
	const isService = SERVICE_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));
	if (isService) {
		if (registeredPaths.has(path)) return { namedGraph: OBSERVATION_GRAPH.SERVICE, endpointPath: path };
		const match = [...registeredPaths].find((rp) => pathMatchesParameterized(rp, path));
		return { namedGraph: OBSERVATION_GRAPH.SERVICE, endpointPath: match ?? path };
	}
	if (registeredPaths.has(path)) return { namedGraph: OBSERVATION_GRAPH.ROUTE, endpointPath: path };
	const paramMatch = [...registeredPaths].find((rp) => pathMatchesParameterized(rp, path));
	if (paramMatch) return { namedGraph: OBSERVATION_GRAPH.ROUTE, endpointPath: paramMatch };
	return { namedGraph: OBSERVATION_GRAPH.EXTERNAL, endpointPath: path };
}

/** Check if a concrete path matches a parameterized route (e.g., /status/revocation matches /status/:purpose). */
function pathMatchesParameterized(route: string, path: string): boolean {
	const routeParts = route.split("/");
	const pathParts = path.split("/");
	if (routeParts.length !== pathParts.length) return false;
	return routeParts.every((rp, i) => rp.startsWith(":") || rp === pathParts[i]);
}

/** Observation data for a single HTTP request */
export type THttpRequestObservation = {
	url: string;
	status: number;
	time: number;
	method: string;
};

/**
 * Track an HTTP host in working memory for the 'http-trace hosts' observation source.
 * Both NodeHttpEvents and PlaywrightEvents use this.
 */
export async function trackHttpHost(world: TWorld, url: string): Promise<void> {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return;
	}
	const priorCount = ((await getFact(world, "count", host, WORKING_MEMORY_GRAPH.HTTP_HOST)) as number | undefined) ?? 0;
	await assertFact(world, "count", host, priorCount + 1, WORKING_MEMORY_GRAPH.HTTP_HOST);
}

/**
 * Track an observed HTTP request as ONE network-interaction record, written through the shared store (the http-trace
 * observation source and the fisheye network sequence both read it). Pass registeredPaths (from IWebServer.mounted) to
 * classify the endpoint. Direction is true to who called: a request the site RECEIVES reads client → site, one it MAKES
 * (origin="site") reads site → host.
 */
export async function trackHttpRequest(world: TWorld, observation: THttpRequestObservation, registeredPaths: Set<string>, origin: THttpOrigin = "client"): Promise<void> {
	const store = world.shared.getStore();
	const timestamp = Date.now();
	const path = observation.url.startsWith("/") ? observation.url : new URL(observation.url).pathname;
	const { namedGraph, endpointPath } = classifyHttpPath(path, registeredPaths);
	const external = namedGraph === OBSERVATION_GRAPH.EXTERNAL;
	const site = activeSitePrincipal(world);
	const sourceId = origin === "site" ? site : CLIENT_ID;
	const host = external ? (hostOf(observation.url) ?? endpointPath) : undefined;
	const destId = host ?? site;
	const requestId = `${observation.method} ${path}`;
	const generatedAtTime = new Date(timestamp).toISOString();

	// Each participant (client, site, external host) is a hidden HttpAgent lifeline; the request is the one record; its
	// source and destination are actor edges (createEdge). A received request reads client → site, an outbound one site → host.
	const nameOf = (id: string) => (id === CLIENT_ID ? "Client" : id === site ? "This site" : id);
	for (const id of new Set([sourceId, destId])) await store.upsertIndividual(HTTP_AGENT_LABEL, { id, name: nameOf(id), generatedAtTime });
	await store.upsertIndividual(HTTP_REQUEST_LABEL, {
		id: requestId,
		name: `${observation.method} ${observation.status} ${observation.time}ms`,
		method: observation.method,
		status: observation.status,
		durationMs: observation.time,
		url: observation.url,
		endpointClass: ENDPOINT_CLASS[namedGraph] ?? "route",
		generatedAtTime,
	});
	await store.createEdge?.(HTTP_REQUEST_LABEL, requestId, LinkRelations.PERFORMED_BY.rel, HTTP_AGENT_LABEL, sourceId);
	await store.createEdge?.(HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, HTTP_AGENT_LABEL, destId);
}
