/**
 * Shared HTTP observation types and helpers.
 *
 * Used by any stepper that tracks HTTP activity, including:
 * - NodeHttpEvents (Node.js fetch/undici requests)
 * - PlaywrightEvents (browser requests via Playwright)
 */

import { z } from "zod";
import type { TWorld } from "./world.js";
import { LinkRelations, writeEdge, writeReferenceEdge } from "./resources.js";
import { activeSitePrincipal } from "./host-id.js";
import { declareBlips, recordBlip } from "./blips.js";

/** The one type every observed HTTP request becomes: the single network-interaction record. Its `performedBy`/`target`
 *  edges make it a message on the fisheye sequence view. */
export const HTTP_REQUEST_LABEL = "HttpRequest";
/** The requesting party: the browser / user agent. A singleton lifeline with id `client`. */
export const HTTP_CLIENT_LABEL = "HttpClient";
/** A serving party: the site itself or an external server. One node per host, carrying `requestCount` — how many
 *  requests reached it, a rollup of its HttpRequests, never tracked separately. */
export const HTTP_HOST_LABEL = "HttpHost";
/** A registered route as a graph vertex — persisted at mount by the web server, targeted by observed requests. */
export const ENDPOINT_LABEL = "Endpoint";
const CLIENT_ID = "client";
/** The endpoint classes: an own page route, the app's service plumbing (/rpc, /sse), or another host. */
export const ENDPOINT_CLASS = { route: "route", service: "service", external: "external" } as const;
/** Every observed request, as a fine-grained occurrence: the persisted record is what the graph and the sequence read,
 *  while this is what a trace shows in order, under the step that caused it. Recorded on every response, so it leaves
 *  to the blip channel the job of costing nothing when nothing is listening. */
export const HTTP_REQUEST_BLIP = "haibun.http.request";
declareBlips({
	name: HTTP_REQUEST_BLIP,
	instrument: "span-event",
	description: "An HTTP request completed, as observed by a client this run drives.",
	unit: "ms",
	attributes: z.object({ method: z.string(), status: z.number(), endpointClass: z.string(), url: z.string() }),
	dimensions: ["method", "status", "endpointClass"],
	origin: true,
});

/** The site's own host node's display name. */
const SITE_NAME = "This site";

/** Who made an observed request: the `client` (browser / user agent) for requests the site RECEIVES, or the `site`
 *  itself for requests it MAKES outbound. Fixes the sequence message's source lifeline so it reads with true direction. */
export type THttpOrigin = "client" | "site";

export const SERVICE_PATH_PREFIXES = ["/sse", "/rpc/"] as const;

/** Whether a path is the app's own service plumbing (/rpc, /sse) rather than a page route. */
export const isServicePath = (path: string): boolean => SERVICE_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));

/** Classify an HTTP path against registered route paths: its endpoint class and the resolved (possibly parameterized) endpoint path. */
export function classifyHttpPath(path: string, registeredPaths: Set<string>): { endpointClass: string; endpointPath: string } {
	const registered = () => (registeredPaths.has(path) ? path : [...registeredPaths].find((rp) => pathMatchesParameterized(rp, path)));
	if (isServicePath(path)) return { endpointClass: ENDPOINT_CLASS.service, endpointPath: registered() ?? path };
	const match = registered();
	return match ? { endpointClass: ENDPOINT_CLASS.route, endpointPath: match } : { endpointClass: ENDPOINT_CLASS.external, endpointPath: path };
}

/** Check if a concrete path matches a parameterized route (e.g., /status/revocation matches /status/:purpose). */
function pathMatchesParameterized(route: string, path: string): boolean {
	const routeParts = route.split("/");
	const pathParts = path.split("/");
	if (routeParts.length !== pathParts.length) return false;
	return routeParts.every((rp, i) => rp.startsWith(":") || rp === pathParts[i]);
}

/** Observation data for a single HTTP request. `durationMs` is unknown for some observers (node fetches). */
export type THttpRequestObservation = {
	url: string;
	status: number;
	durationMs?: number;
	method: string;
};

/** Per-store memo so the per-response path skips work that cannot change: the singleton client node, an already-linked
 *  endpoint, and re-reading a host's requestCount. A scenario's fresh store starts a fresh entry. */
const trackCache = new WeakMap<object, { ensured: Set<string>; counts: Map<string, number> }>();

/**
 * Track an observed HTTP request as ONE network-interaction record, written through the shared store (the http-trace
 * observation sources and the fisheye network sequence read the same records). A request runs client → endpoint/host:
 * the requesting party is the browser (HttpClient), or the site itself for a request it MAKES outbound (origin="site");
 * the destination is the registered Endpoint it hit (the vertex the web server persists at mount), or the external
 * HttpHost. Every endpoint links `isPartOf` to the site's host node, so the graph connects the whole exchange:
 * client → request → endpoint → site, or client/site → request → host.
 */
/** An outbound request the instance itself makes — no route table, origin "site". The one call shape for every
 *  outbound observer (the undici channels, a subprocess transport), so the convention is stated once. */
export function trackOutboundRequest(world: TWorld, observation: THttpRequestObservation): Promise<void> {
	return trackHttpRequest(world, observation, NO_ROUTES, "site");
}

const NO_ROUTES: Set<string> = new Set();

export async function trackHttpRequest(world: TWorld, observation: THttpRequestObservation, registeredPaths: Set<string>, origin: THttpOrigin = "client"): Promise<void> {
	const store = world.shared.getStore();
	let cache = trackCache.get(store);
	if (!cache) trackCache.set(store, (cache = { ensured: new Set(), counts: new Map() }));
	const memo = cache;
	const url = observation.url.startsWith("/") ? undefined : new URL(observation.url);
	const path = url?.pathname ?? observation.url;
	const { endpointClass, endpointPath } = classifyHttpPath(path, registeredPaths);
	const external = endpointClass === ENDPOINT_CLASS.external;
	const site = activeSitePrincipal(world);
	const hostId = external ? url?.hostname || endpointPath : site;
	const requestId = `${observation.method} ${path}`;
	const generatedAtTime = new Date().toISOString();

	const upsertHost = async (id: string, delta: number) => {
		let count = memo.counts.get(id);
		if (count === undefined) count = (await store.getIndividual<{ requestCount?: number }>(HTTP_HOST_LABEL, id))?.requestCount ?? 0;
		memo.counts.set(id, count + delta);
		await store.upsertIndividual(HTTP_HOST_LABEL, { id, name: id === site ? SITE_NAME : id, requestCount: count + delta, generatedAtTime });
	};
	const once = async (key: string, write: () => Promise<unknown>) => {
		if (memo.ensured.has(key)) return;
		memo.ensured.add(key);
		await write();
	};

	// The participants and the request record (independent writes), then its actor edges (which target them).
	await Promise.all([
		upsertHost(hostId, 1),
		origin === "client"
			? once(CLIENT_ID, () => store.upsertIndividual(HTTP_CLIENT_LABEL, { id: CLIENT_ID, name: "Client", generatedAtTime }))
			: hostId === site
				? Promise.resolve()
				: once(`host:${site}`, () => upsertHost(site, 0)),
		store.upsertIndividual(HTTP_REQUEST_LABEL, {
			id: requestId,
			method: observation.method,
			status: observation.status,
			durationMs: observation.durationMs,
			url: observation.url,
			endpointClass,
			generatedAtTime,
		}),
	]);
	recordBlip(world, HTTP_REQUEST_BLIP, observation.durationMs, { method: observation.method, status: observation.status, endpointClass, url: observation.url });
	const [sourceLabel, sourceId] = origin === "site" ? [HTTP_HOST_LABEL, site] : [HTTP_CLIENT_LABEL, CLIENT_ID];
	await Promise.all([
		writeEdge(store, HTTP_REQUEST_LABEL, requestId, LinkRelations.PERFORMED_BY.rel, sourceLabel, sourceId),
		external
			? writeReferenceEdge(store, HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, HTTP_HOST_LABEL, hostId)
			: // The endpoint's own record is written when its route is mounted, which may not have landed when the first
				// request to it is observed: a reference holds the observation until it does, rather than losing the request.
				writeReferenceEdge(store, HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, ENDPOINT_LABEL, endpointPath).then(() =>
					once(`endpoint:${endpointPath}`, async () => {
						// The link may already exist from an earlier scenario's carried quads — check the store, once per endpoint.
						const linked = await store.query({ subject: endpointPath, predicate: LinkRelations.PART_OF.rel, namedGraph: ENDPOINT_LABEL });
						if (linked.length === 0) await writeEdge(store, ENDPOINT_LABEL, endpointPath, LinkRelations.PART_OF.rel, HTTP_HOST_LABEL, site);
					}),
				),
	]);
}
