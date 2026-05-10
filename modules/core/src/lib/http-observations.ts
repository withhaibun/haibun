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
import { OBSERVATION_GRAPH as WORKING_MEMORY_GRAPH, assertFact, getFact } from "./working-memory.js";

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
export async function trackHttpRequest(world: TWorld, observation: THttpRequestObservation, registeredPaths: Set<string>): Promise<void> {
	const priorCount = ((await getFact(world, "count", "__index__", WORKING_MEMORY_GRAPH.HTTP_REQUEST)) as number | undefined) ?? 0;
	const id = `req-${priorCount + 1}`;
	await assertFact(world, "observation", id, observation, WORKING_MEMORY_GRAPH.HTTP_REQUEST);
	await assertFact(world, "count", "__index__", priorCount + 1, WORKING_MEMORY_GRAPH.HTTP_REQUEST);

	const timestamp = Date.now();
	const path = observation.url.startsWith("/") ? observation.url : new URL(observation.url).pathname;
	const { namedGraph, endpointPath } = classifyHttpPath(path, registeredPaths);
	const subject = `${observation.method} ${path}`;
	emitQuadObservation(world.eventLogger, `quad-http-${timestamp}-${id}-name`, {
		subject,
		predicate: "name",
		object: `${observation.method} ${observation.status} ${observation.time}ms`,
		namedGraph,
		timestamp,
	});
	if (namedGraph !== OBSERVATION_GRAPH.EXTERNAL)
		emitQuadObservation(world.eventLogger, `quad-http-${timestamp}-${id}-endpoint`, { subject, predicate: "endpoint", object: endpointPath, namedGraph, timestamp });
	const seqPath = world.runtime.currentSeqPath;
	if (seqPath)
		emitQuadObservation(world.eventLogger, `quad-http-${timestamp}-${id}-seqPath`, { subject, predicate: LinkRelations.SEQ_PATH.rel, object: seqPath, namedGraph, timestamp });
}
