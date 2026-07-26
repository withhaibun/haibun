import { describe, it, expect } from "vitest";
import { trackHttpRequest, classifyHttpPath, OBSERVATION_GRAPH } from "./http-observations.js";
import { extractQuadsFromEvents } from "./quad-types.js";
import { LinkRelations } from "./resources.js";
import { registeredPaths, type IRouteRegistry } from "./execution.js";
import type { TWorld } from "./world.js";
import { QuadStore } from "./quad-store.js";

const MOUNTED: IRouteRegistry = {
	mounted: {
		get: { "/app": "1", "/.well-known/did.json": "1", "/status/:purpose": "1", "/sse": "1" },
		post: { "/rpc/:_method": "1", "/reports/check": "1" },
	},
};
const PATHS = registeredPaths(MOUNTED);

function mockWorld(): { world: TWorld; emitted: Record<string, unknown>[] } {
	const emitted: Record<string, unknown>[] = [];
	const store = new QuadStore();
	const world = {
		runtime: { stepResults: [] },
		eventLogger: { emit: (e: Record<string, unknown>) => emitted.push(e) },
		shared: { getStore: () => store },
	} as unknown as TWorld;
	return { world, emitted };
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

describe("trackHttpRequest", () => {
	it("emits name and endpoint quads with correct namedGraph", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/.well-known/did.json", status: 200, time: 5, method: "GET" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		const nameQuad = quads.find((q) => q.predicate === "name");
		const edgeQuad = quads.find((q) => q.predicate === "endpoint");
		expect(nameQuad?.subject).toBe("GET /.well-known/did.json");
		expect(nameQuad?.namedGraph).toBe(OBSERVATION_GRAPH.ROUTE);
		expect(edgeQuad?.object).toBe("/.well-known/did.json");
	});

	it("classifies external URLs with no endpoint edge, but as a network-sequence message to the host", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://fonts.google.com/css2", status: 200, time: 100, method: "GET" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		expect(quads.every((q) => q.namedGraph === OBSERVATION_GRAPH.EXTERNAL)).toBe(true);
		expect(quads.find((q) => q.predicate === "endpoint")).toBeUndefined(); // external isn't a registered route
		// but it IS a message: performedBy the site → target the external host, so the sequence view reads site → host.
		expect(quads.find((q) => q.predicate === LinkRelations.PERFORMED_BY.rel)).toBeDefined();
		expect(quads.find((q) => q.predicate === LinkRelations.AS_TARGET.rel)?.object).toBe("fonts.google.com");
	});

	it("models RPC calls as a hidden-by-default service message, still reachable", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/rpc/step.list", status: 200, time: 30, method: "POST" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		expect(quads.every((q) => q.namedGraph === OBSERVATION_GRAPH.SERVICE)).toBe(true); // observation/shu-service is hidden by default
		expect(quads.find((q) => q.predicate === "endpoint")?.object).toBe("/rpc/:_method");
		// service calls are modelled as messages too (not skipped): site → the /rpc endpoint, so they read on the sequence when unticked.
		expect(quads.find((q) => q.predicate === LinkRelations.PERFORMED_BY.rel)).toBeDefined();
		expect(quads.find((q) => q.predicate === LinkRelations.AS_TARGET.rel)?.object).toBe("/rpc/:_method");
	});
});
