import { describe, it, expect } from "vitest";
import { trackHttpRequest, classifyHttpPath, OBSERVATION_GRAPH, HTTP_REQUEST_LABEL, HTTP_AGENT_LABEL } from "./http-observations.js";
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
		eventLogger: { emit: () => undefined },
		shared: { getStore: () => store },
	} as unknown as TWorld;
	return { world, store };
}

describe("classifyHttpPath", () => {
	it("classifies registered app paths as observation/http", () => {
		expect(classifyHttpPath("/app", PATHS)).toEqual({ namedGraph: OBSERVATION_GRAPH.ROUTE, endpointPath: "/app" });
	});

	it("classifies parameterized paths as observation/http with resolved endpoint", () => {
		expect(classifyHttpPath("/status/revocation", PATHS)).toEqual({ namedGraph: OBSERVATION_GRAPH.ROUTE, endpointPath: "/status/:purpose" });
	});

	it("classifies /rpc paths as observation/service with parameterized endpoint", () => {
		expect(classifyHttpPath("/rpc/step.list", PATHS)).toEqual({ namedGraph: OBSERVATION_GRAPH.SERVICE, endpointPath: "/rpc/:_method" });
	});

	it("classifies /sse as observation/service", () => {
		expect(classifyHttpPath("/sse", PATHS)).toEqual({ namedGraph: OBSERVATION_GRAPH.SERVICE, endpointPath: "/sse" });
	});

	it("classifies unregistered paths as observation/external", () => {
		expect(classifyHttpPath("/css2", PATHS)).toEqual({ namedGraph: OBSERVATION_GRAPH.EXTERNAL, endpointPath: "/css2" });
	});
});

describe("trackHttpRequest persists one network-interaction record via the store", () => {
	const propOf = (quads: TQuad[], subject: string, predicate: string) => quads.find((q) => q.subject === subject && q.predicate === predicate);

	it("persists a received route request as a client → site record, endpoint class 'route', client its own agent node", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/.well-known/did.json", status: 200, time: 5, method: "GET" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /.well-known/did.json";
		expect(propOf(req, id, "method")?.object).toBe("GET");
		expect(propOf(req, id, "endpointClass")?.object).toBe("route");
		expect(propOf(req, id, "performedBy")?.object).toBe("client"); // the browser made the call…
		expect(propOf(req, id, "target")?.object).toBe(activeSitePrincipal(world)); // …to this site
		expect(propOf(req, id, "target")?.objectType).toBe(HTTP_AGENT_LABEL); // an EDGE (objectType), created by createEdge — not a property
		const agents = await store.query({ namedGraph: HTTP_AGENT_LABEL });
		expect(propOf(agents, "client", "name")?.object).toBe("Client"); // the client lifeline is its own node
	});

	it("persists a browser request to an external host as client → host, the host its own agent node", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://fonts.google.com/css2", status: 200, time: 100, method: "GET" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /css2";
		expect(propOf(req, id, "endpointClass")?.object).toBe("external");
		expect(propOf(req, id, "performedBy")?.object).toBe("client");
		expect(propOf(req, id, "target")?.object).toBe("fonts.google.com");
		const agents = await store.query({ namedGraph: HTTP_AGENT_LABEL });
		expect(propOf(agents, "fonts.google.com", "name")?.object).toBe("fonts.google.com");
	});

	it("persists an RPC/service call as a client → site record classed 'service'", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/rpc/step.list", status: 200, time: 30, method: "POST" }, PATHS);
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "POST /rpc/step.list";
		expect(propOf(req, id, "endpointClass")?.object).toBe("service");
		expect(propOf(req, id, "performedBy")?.object).toBe("client");
		expect(propOf(req, id, "target")?.object).toBe(activeSitePrincipal(world));
	});

	it("persists an outbound (site-originated) request as site → host", async () => {
		const { world, store } = mockWorld();
		await trackHttpRequest(world, { url: "http://api.example.com/v1", status: 200, time: 40, method: "GET" }, PATHS, "site");
		const req = await store.query({ namedGraph: HTTP_REQUEST_LABEL });
		const id = "GET /v1";
		expect(propOf(req, id, "performedBy")?.object).toBe(activeSitePrincipal(world)); // the site made this call…
		expect(propOf(req, id, "target")?.object).toBe("api.example.com"); // …to an external host
	});
});
