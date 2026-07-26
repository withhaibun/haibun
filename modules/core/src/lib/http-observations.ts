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

/** The one type every observed HTTP request becomes: the single network-interaction record. Its `performedBy`/`target`
 *  edges make it a message on the fisheye sequence view. */
export const HTTP_REQUEST_LABEL = "HttpRequest";
/** The requesting party: the browser / user agent. A singleton lifeline with id `client`. */
export const HTTP_CLIENT_LABEL = "HttpClient";
/** A serving party: the site itself or an external server. One node per host, carrying `requestCount` — how many
 *  requests reached it, a rollup of its HttpRequests, never tracked separately. */
export const HTTP_HOST_LABEL = "HttpHost";
const CLIENT_ID = "client";
/** The endpoint classes: an own page route, the app's service plumbing (/rpc, /sse), or another host. A property on the
 *  one request record (and on the Endpoint vertex), so class reads in the detail without a graph per class. */
export const ENDPOINT_CLASS = { route: "route", service: "service", external: "external" } as const;
/** The site's own host node's display name. */
const SITE_NAME = "This site";

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

const CLASS_OF_GRAPH: Record<string, string> = { [OBSERVATION_GRAPH.ROUTE]: ENDPOINT_CLASS.route, [OBSERVATION_GRAPH.SERVICE]: ENDPOINT_CLASS.service, [OBSERVATION_GRAPH.EXTERNAL]: ENDPOINT_CLASS.external };

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

/** Observation data for a single HTTP request. `time` (duration in ms) is unknown for some observers (node fetches). */
export type THttpRequestObservation = {
	url: string;
	status: number;
	time?: number;
	method: string;
};

/**
 * Track an observed HTTP request as ONE network-interaction record, written through the shared store (the http-trace
 * observation sources and the fisheye network sequence read the same records). A request runs client → endpoint/host:
 * the requesting party is the browser (HttpClient), or the site itself for a request it MAKES outbound (origin="site");
 * the destination is the registered Endpoint the request hit (an own route or service — the SAME Endpoint vertex the
 * web server persists at mount), or the external HttpHost. Every endpoint links `isPartOf` to the site's host node, and
 * a host's `requestCount` rolls up here — there is no separate host tracking. The graph connects the whole exchange:
 * client → request → endpoint → site, or client/site → request → host.
 */
export async function trackHttpRequest(world: TWorld, observation: THttpRequestObservation, registeredPaths: Set<string>, origin: THttpOrigin = "client"): Promise<void> {
	const store = world.shared.getStore();
	const timestamp = Date.now();
	const path = observation.url.startsWith("/") ? observation.url : new URL(observation.url).pathname;
	const { namedGraph, endpointPath } = classifyHttpPath(path, registeredPaths);
	const external = namedGraph === OBSERVATION_GRAPH.EXTERNAL;
	const site = activeSitePrincipal(world);
	const hostId = external ? (hostOf(observation.url) ?? endpointPath) : site;
	const requestId = `${observation.method} ${path}`;
	const generatedAtTime = new Date(timestamp).toISOString();

	// The serving host (one node per host; the site is a host too) with its rolled-up request count, and the requesting
	// party's node; the site's own host node is preserved (not re-counted) when it is the SOURCE of an outbound call.
	const prior = await store.getIndividual<{ requestCount?: number }>(HTTP_HOST_LABEL, hostId);
	await store.upsertIndividual(HTTP_HOST_LABEL, { id: hostId, name: hostId === site ? SITE_NAME : hostId, requestCount: (prior?.requestCount ?? 0) + 1, generatedAtTime });
	if (origin === "client") await store.upsertIndividual(HTTP_CLIENT_LABEL, { id: CLIENT_ID, name: "Client", generatedAtTime });
	if (origin === "site" && hostId !== site) {
		const sitePrior = await store.getIndividual<{ requestCount?: number }>(HTTP_HOST_LABEL, site);
		await store.upsertIndividual(HTTP_HOST_LABEL, { id: site, name: SITE_NAME, requestCount: sitePrior?.requestCount ?? 0, generatedAtTime });
	}
	const endpointClass = CLASS_OF_GRAPH[namedGraph];
	if (!endpointClass) throw new Error(`trackHttpRequest: no endpoint class for graph "${namedGraph}"`);
	await store.upsertIndividual(HTTP_REQUEST_LABEL, {
		id: requestId,
		name: `${observation.method} ${observation.status}${observation.time !== undefined ? ` ${observation.time}ms` : ""}`,
		method: observation.method,
		status: observation.status,
		durationMs: observation.time,
		url: observation.url,
		endpointClass,
		generatedAtTime,
	});

	// The actor edges: performedBy → the requesting party; target → the registered Endpoint vertex (own routes/services)
	// or the external host. An own endpoint also links isPartOf → the site's host (once), closing the visual chain.
	const [sourceLabel, sourceId] = origin === "site" ? [HTTP_HOST_LABEL, site] : [HTTP_CLIENT_LABEL, CLIENT_ID];
	await store.createEdge?.(HTTP_REQUEST_LABEL, requestId, LinkRelations.PERFORMED_BY.rel, sourceLabel, sourceId);
	if (external) {
		await store.createEdge?.(HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, HTTP_HOST_LABEL, hostId);
	} else {
		await store.createEdge?.(HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, OBSERVATION_GRAPH.ENDPOINT, endpointPath);
		const linked = await store.query({ subject: endpointPath, predicate: LinkRelations.PART_OF.rel, namedGraph: OBSERVATION_GRAPH.ENDPOINT });
		if (linked.length === 0) await store.createEdge?.(OBSERVATION_GRAPH.ENDPOINT, endpointPath, LinkRelations.PART_OF.rel, HTTP_HOST_LABEL, site);
	}
}
