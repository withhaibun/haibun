/**
 * HTTP observation types and helpers.
 *
 * A stepper that tracks HTTP activity calls these helpers. web-playwright's page observer records a page's requests through
 * `trackHttpRequest`, and `trackOutboundRequest` records a request the instance makes.
 */

import { RPC_ROUTE, SSE_ROUTE } from "./rpc-wire.js";
import { z } from "zod";
import type { TWorld } from "./world.js";
import { ENDPOINT_LABEL, HTTP_CLIENT_LABEL, HTTP_HOST_LABEL, HTTP_REQUEST_LABEL, LinkRelations, writeEdge, writeReferenceEdge } from "./resources.js";
import { activeSitePrincipal } from "./host-id.js";
import { declareBlips } from "./blips.js";
import { recordBlip } from "./record-blip.js";
import { recordOf } from "./records/pipelines/record-reads.js";

const CLIENT_ID = "client";
/** The endpoint classes: a page route of this site, a service route of the app (/rpc, /sse), or another host. */
export const ENDPOINT_CLASS = { route: "route", service: "service", external: "external" } as const;
/** The blip for every observed request. The graph and the sequence read the persisted record. A trace shows this blip
 *  in order, under the step that caused the request. trackHttpRequest records it for every request, and recordBlip
 *  returns early when the blip doesn't have a subscriber. */
const HTTP_REQUEST_BLIP = "haibun.http.request";
declareBlips({
	name: HTTP_REQUEST_BLIP,
	instrument: "span-event",
	description: "An HTTP request completed. This instance or a client that the instance drives made the request.",
	unit: "ms",
	attributes: z.object({ method: z.string(), status: z.number(), endpointClass: z.string(), url: z.string() }),
	dimensions: ["method", "status", "endpointClass"],
	origin: true,
});

/** The site's own host node's display name. */
const SITE_NAME = "This site";

/** The request count a host record holds. A host that isn't recorded counts zero requests. */
const HostCountSchema = z.object({ requestCount: z.number().default(0) });

/** The party that made an observed request. `client` is the browser or user agent that the instance drives. `site` is this
 *  site, for a request it makes outbound. The origin selects the target of the request's `performedBy` edge. The
 *  sequence view draws that target as the message's source lifeline, so each message points from requester to
 *  destination. */
type THttpOrigin = "client" | "site";

const SERVICE_PATH_PREFIXES = [SSE_ROUTE, RPC_ROUTE] as const;

/** True when a path is one of the app's service routes (/rpc, /sse) and not a page route. */
export const isServicePath = (path: string): boolean => SERVICE_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));

/** Classifies an HTTP path against registered route paths. Returns the endpoint class and the endpoint path. The endpoint
 *  path is the registered route the path matches, or the path itself when a registered route doesn't match. A
 *  registered route can hold parameters such as `:purpose`. */
export function classifyHttpPath(path: string, registeredPaths: Set<string>): { endpointClass: string; endpointPath: string } {
	const registered = () => (registeredPaths.has(path) ? path : [...registeredPaths].find((rp) => pathMatchesParameterized(rp, path)));
	if (isServicePath(path)) return { endpointClass: ENDPOINT_CLASS.service, endpointPath: registered() ?? path };
	const match = registered();
	return match ? { endpointClass: ENDPOINT_CLASS.route, endpointPath: match } : { endpointClass: ENDPOINT_CLASS.external, endpointPath: path };
}

/** True when a concrete path matches a parameterized route. For example, /status/revocation matches /status/:purpose. */
function pathMatchesParameterized(route: string, path: string): boolean {
	const routeParts = route.split("/");
	const pathParts = path.split("/");
	if (routeParts.length !== pathParts.length) return false;
	return routeParts.every((rp, i) => rp.startsWith(":") || rp === pathParts[i]);
}

/** Observation data for a single HTTP request. `durationMs` is optional, since an observer of a node fetch may not measure it. */
type THttpRequestObservation = { url: string; status: number; durationMs?: number; method: string };

/** Per-store memo so the per-response path skips work that cannot change: the singleton client node, an already-linked
 *  endpoint, and re-reading a host's requestCount. A scenario's fresh store starts a fresh entry. */
const trackCache = new WeakMap<object, { ensured: Set<string>; counts: Map<string, number> }>();

/** Records an outbound request the instance makes, with origin "site" and without a route table. Every outbound
 *  observer calls it, so one function sets that origin and the empty route table. */
export function trackOutboundRequest(world: TWorld, observation: THttpRequestObservation): Promise<void> {
	return trackHttpRequest(world, observation, NO_ROUTES, "site");
}

const NO_ROUTES: Set<string> = new Set();

/**
 * Records an observed HTTP request in the shared store. It upserts one HttpRequest record per method and path, upserts
 * the requester and destination records, and writes the edges between them. The http-trace observation sources and the
 * polymorphic view's network sequence read these records. The requester is the browser (HttpClient), or the site for a
 * request it makes outbound (origin="site"). The destination is the registered Endpoint the request reached, or the
 * external HttpHost. The web server persists each Endpoint vertex when it mounts the route. Every endpoint links
 * `isPartOf` to the site's host node. The graph then connects the whole exchange: client → request → endpoint → site,
 * or client/site → request → host.
 */
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
		if (count === undefined) count = HostCountSchema.parse((await recordOf(store, HTTP_HOST_LABEL, id)) ?? {}).requestCount;
		memo.counts.set(id, count + delta);
		await store.upsertIndividual(HTTP_HOST_LABEL, { id, name: id === site ? SITE_NAME : id, requestCount: count + delta, generatedAtTime });
	};
	const once = async (key: string, write: () => Promise<unknown>) => {
		if (memo.ensured.has(key)) return;
		memo.ensured.add(key);
		await write();
	};

	// Writes the participants and the request record in parallel, then the actor edges that target them.
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
			: // The web server writes the endpoint's record when it mounts the route. The first request can arrive before
				// that write. A reference edge holds the observation until the record exists, so the request isn't lost.
				writeReferenceEdge(store, HTTP_REQUEST_LABEL, requestId, LinkRelations.AS_TARGET.rel, ENDPOINT_LABEL, endpointPath).then(() =>
					once(`endpoint:${endpointPath}`, async () => {
						// An earlier scenario's carried quads may already hold the link, so the store is checked once per endpoint.
						const linked = await store.query({ subject: endpointPath, predicate: LinkRelations.PART_OF.rel, namedGraph: ENDPOINT_LABEL });
						if (linked.length === 0) await writeEdge(store, ENDPOINT_LABEL, endpointPath, LinkRelations.PART_OF.rel, HTTP_HOST_LABEL, site);
					}),
				),
	]);
}
