import { describe, it, expect } from "vitest";
import { trackHttpRequest, classifyHttpPath, ENDPOINT_CLASS, ENDPOINT_LABEL, HTTP_REQUEST_LABEL, HTTP_CLIENT_LABEL, HTTP_HOST_LABEL } from "./http-observations.js";
import { activeSitePrincipal } from "./host-id.js";
import { registeredPaths, type IRouteRegistry } from "./execution.js";
import type { TWorld } from "./world.js";
import type { TQuad } from "./quad-types.js";
import { QuadStore } from "./quad-store.js";

const MOUNTED: IRouteRegistry = {
	mounted: {
		get: { "/app": "1", "/.well-known/did.json": "1", "/status/:purpose": "1", "/sse": "1" },
		post: { "/rpc/:_method": "1", "/reports/check": "1" },
	},
};
const PATHS = registeredPaths(MOUNTED);

function mockWorld(): { world: TWorld; store: QuadStore } {
	const store = new QuadStore();
	const world = {
		runtime: { stepResults: [] },
		eventLogger: { emit: () => undefined, hasSubscribers: () => false },
		shared: { getStore: () => store },
	} as unknown as TWorld;
	return { world, store };
}

describe("classifyHttpPath", () => {
	it("classifies registered app paths as route", () => {
		expect(classifyHttpPath("/app", PATHS)).toEqual({ endpointClass: ENDPOINT_CLASS.route, endpointPath: "/app" });
	});

	it("classifies parameterized paths as route with resolved endpoint", () => {
		expect(classifyHttpPath("/status/revocation", PATHS)).toEqual({ endpointClass: ENDPOINT_CLASS.route, endpointPath: "/status/:purpose" });
	});

	it("classifies /rpc paths as service with parameterized endpoint", () => {
		expect(classifyHttpPath("/rpc/step.list", PATHS)).toEqual({ endpointClass: ENDPOINT_CLASS.service, endpointPath: "/rpc/:_method" });
	});

	it("classifies /sse as service", () => {
		expect(classifyHttpPath("/sse", PATHS)).toEqual({ endpointClass: ENDPOINT_CLASS.service, endpointPath: "/sse" });
	});

	it("classifies unregistered paths as external", () => {
		expect(classifyHttpPath("/css2", PATHS)).toEqual({ endpointClass: ENDPOINT_CLASS.external, endpointPath: "/css2" });
	});
});

describe("trackHttpRequest: one connected network-interaction record per request", () => {
	const propOf = (quads: TQuad[], subject: string, predicate: string) => quads.find((q) => q.subject === subject && q.predicate === predicate);

	it("a received route request reads client → the registered Endpoint, which isPartOf the site's host", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/.well-known/did.json", status: 200, durationMs: 5, method: "GET" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /.well-known/did.json";
		expect(propOf(req, id, "method")?.object).toBe("GET");
		expect(propOf(req, id, "performedBy")?.object).toBe("client"); // the browser made the call…
		expect(propOf(req, id, "target")?.object).toBe("/.well-known/did.json"); // …to the registered endpoint
		expect(propOf(req, id, "target")?.objectType).toBe(ENDPOINT_LABEL); // an EDGE to the existing Endpoint vertex
		const client = await store.query({ namedGraph: HTTP_CLIENT_LABEL });
		expect(propOf(client, "client", "name")?.object).toBe("Client"); // the client lifeline is its own node
		// the endpoint links to the site's host, closing the chain client → request → endpoint → site
		const ep = await store.query({ subject: "/.well-known/did.json", predicate: "isPartOf", namedGraph: ENDPOINT_LABEL });
		expect(ep[0]?.object).toBe(activeSitePrincipal(world));
		expect(ep[0]?.objectType).toBe(HTTP_HOST_LABEL);
	});

	it("a browser request to an external host reads client → host, the host its own node", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://fonts.google.com/css2", status: 200, durationMs: 100, method: "GET" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /css2";
		expect(propOf(req, id, "endpointClass")?.object).toBe(ENDPOINT_CLASS.external);
		expect(propOf(req, id, "performedBy")?.object).toBe("client");
		expect(propOf(req, id, "target")?.object).toBe("fonts.google.com");
		expect(propOf(req, id, "target")?.objectType).toBe(HTTP_HOST_LABEL);
		const hosts = await store.query({ namedGraph: HTTP_HOST_LABEL });
		expect(propOf(hosts, "fonts.google.com", "name")?.object).toBe("fonts.google.com");
	});

	it("an RPC/service call reads client → its /rpc Endpoint, classed service", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/rpc/step.list", status: 200, durationMs: 30, method: "POST" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "POST /rpc/step.list";
		expect(propOf(req, id, "endpointClass")?.object).toBe(ENDPOINT_CLASS.service);
		expect(propOf(req, id, "target")?.object).toBe("/rpc/:_method"); // the parameterized registered endpoint
		expect(propOf(req, id, "target")?.objectType).toBe(ENDPOINT_LABEL);
	});

	it("an outbound (site-originated) request reads site → host; undici observations omit duration", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://api.example.com/v1", status: 200, method: "GET" }, new Set(), "site");
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /v1";
		expect(propOf(req, id, "performedBy")?.object).toBe(activeSitePrincipal(world)); // the site made this call…
		expect(propOf(req, id, "performedBy")?.objectType).toBe(HTTP_HOST_LABEL); // …as its host node…
		expect(propOf(req, id, "target")?.object).toBe("api.example.com"); // …to an external host
		expect(propOf(req, id, "durationMs")).toBeUndefined(); // no duration field when unknown
	});

	it("a host's requestCount rolls up from the requests that reached it — no separate host tracking", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://fonts.google.com/a", status: 200, durationMs: 1, method: "GET" }, PATHS);
		await trackHttpRequest(world, { url: "http://fonts.google.com/b", status: 200, durationMs: 1, method: "GET" }, PATHS);
		await trackHttpRequest(world, { url: "http://localhost:8223/app", status: 200, durationMs: 1, method: "GET" }, PATHS);
		const hosts = await store.query({ namedGraph: HTTP_HOST_LABEL });
		expect(propOf(hosts, "fonts.google.com", "requestCount")?.object).toBe(2);
		expect(propOf(hosts, activeSitePrincipal(world), "requestCount")?.object).toBe(1); // the site's own host counts requests it served
	});
});
