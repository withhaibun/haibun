/**
 * Shared HTTP observation types and helpers.
 *
 * Used by any stepper that tracks HTTP activity, including:
 * - NodeHttpEvents (Node.js fetch/undici requests)
 * - PlaywrightEvents (browser requests via Playwright)
 */

import type { TWorld } from "./world.js";
import { emitQuadObservation } from "./quad-types.js";
import { LinkRelations } from "./resources.js";
import { activeSitePrincipal } from "./host-id.js";
import { OBSERVATION_GRAPH as WORKING_MEMORY_GRAPH, assertFact, getFact } from "./working-memory.js";

/** The @type of an observed HTTP request node — W3C HTTP vocabulary (`http://www.w3.org/2011/http#Request`). Its
 *  `performedBy` (source) + `target` (destination) actor edges make it a message on the fisheye sequence view. */
export const HTTP_REQUEST_LABEL = "HttpRequest";
/** Participant @types: the site and external hosts are services; the client (browser / user agent) is an application. */
const SERVICE_TYPE = "as:Service";
const CLIENT_TYPE = "as:Application";
/** The singleton client lifeline: the browser / user agent that calls the site's routes and external resources. */
const CLIENT_ID = "client";

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
 * Track an HTTP request in working memory for the 'http-trace' observation source.
 * Pass registeredPaths (from IWebServer.mounted) to classify observations into namedGraphs.
 */
export async function trackHttpRequest(world: TWorld, observation: THttpRequestObservation, registeredPaths: Set<string>, origin: THttpOrigin = "client"): Promise<void> {
	const priorCount = ((await getFact(world, "count", "__index__", WORKING_MEMORY_GRAPH.HTTP_REQUEST)) as number | undefined) ?? 0;
	const id = `req-${priorCount + 1}`;
	await assertFact(world, "observation", id, observation, WORKING_MEMORY_GRAPH.HTTP_REQUEST);
	await assertFact(world, "count", "__index__", priorCount + 1, WORKING_MEMORY_GRAPH.HTTP_REQUEST);

	const timestamp = Date.now();
	const path = observation.url.startsWith("/") ? observation.url : new URL(observation.url).pathname;
	const { namedGraph, endpointPath } = classifyHttpPath(path, registeredPaths);
	const subject = `${observation.method} ${path}`;
	const q = (suffix: string, subj: string, predicate: string, object: string, objectType?: string) =>
		emitQuadObservation(world.eventLogger, `quad-http-${timestamp}-${id}-${suffix}`, { subject: subj, predicate, object, namedGraph, timestamp, ...(objectType ? { objectType } : {}) });

	q("name", subject, "name", `${observation.method} ${observation.status} ${observation.time}ms`);
	if (namedGraph !== OBSERVATION_GRAPH.EXTERNAL) q("endpoint", subject, "endpoint", endpointPath);
	if (world.runtime.currentSeqPath) q("seqPath", subject, LinkRelations.SEQ_PATH.rel, world.runtime.currentSeqPath);

	// Model the request as a message on the network sequence, with TRUE direction: a request the site RECEIVES reads
	// client → site, one it MAKES reads site → host. `@type` HttpRequest, timed by generatedAtTime. Both actor rels are
	// core (performedBy source / target destination), so the fisheye sequence view reads it with no per-type wiring.
	// Service calls (/rpc, /sse) are modelled too but land in observation/shu-service — hidden by default
	// (isInstrumentationGraph), reachable when unticked; SSE ingests directly and getClusteredQuads is a snapshot fetch, so
	// this never re-observes itself. The client and any external host are emitted as typed nodes so each actor edge has a
	// lifeline to point at (the site is the existing Principal node); `objectType` is what makes an actor quad a graph edge.
	const site = activeSitePrincipal(world);
	const external = namedGraph === OBSERVATION_GRAPH.EXTERNAL;
	const source = origin === "site" ? { id: site, type: SERVICE_TYPE } : { id: CLIENT_ID, type: CLIENT_TYPE };
	const dest = external ? { id: hostOf(observation.url) ?? endpointPath, type: SERVICE_TYPE } : { id: site, type: SERVICE_TYPE };
	q("type", subject, "type", HTTP_REQUEST_LABEL);
	q("from", subject, LinkRelations.PERFORMED_BY.rel, source.id, source.type);
	q("to", subject, LinkRelations.AS_TARGET.rel, dest.id, dest.type);
	q("time", subject, LinkRelations.GENERATED_AT_TIME.rel, new Date(timestamp).toISOString());
	if (source.id === CLIENT_ID) {
		q("client-type", CLIENT_ID, "type", CLIENT_TYPE);
		q("client-name", CLIENT_ID, "name", "Client");
	}
	if (external && dest.id !== site) {
		q("host-type", dest.id, "type", SERVICE_TYPE);
		q("host-name", dest.id, "name", dest.id);
	}
}
