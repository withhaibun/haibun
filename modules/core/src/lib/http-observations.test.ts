import { describe, it, expect } from "vitest";
import { trackHttpRequest, classifyHttpPath, OBSERVATION_GRAPH } from "./http-observations.js";
import { extractQuadsFromEvents } from "./quad-types.js";
import { LinkRelations } from "./resources.js";
import { activeSitePrincipal } from "./host-id.js";
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
	const from = (quads: ReturnType<typeof extractQuadsFromEvents>) => quads.find((q) => q.predicate === LinkRelations.PERFORMED_BY.rel);
	const to = (quads: ReturnType<typeof extractQuadsFromEvents>) => quads.find((q) => q.predicate === LinkRelations.AS_TARGET.rel);

	it("models a received route request as a client → site message with its name + endpoint", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/.well-known/did.json", status: 200, time: 5, method: "GET" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		expect(quads.find((q) => q.predicate === "name")?.subject).toBe("GET /.well-known/did.json");
		expect(quads.find((q) => q.predicate === "name")?.namedGraph).toBe(OBSERVATION_GRAPH.ROUTE);
		expect(quads.find((q) => q.predicate === "endpoint")?.object).toBe("/.well-known/did.json");
		expect(from(quads)?.object).toBe("client"); // the browser made the call…
		expect(to(quads)?.object).toBe(activeSitePrincipal(world)); // …to this site's route
		expect(to(quads)?.objectType).toBe("as:Service"); // objectType is what makes the actor quad a graph EDGE, not a property
	});

	it("models a browser request to an external host as a client → host message, host emitted as a typed node", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://fonts.google.com/css2", status: 200, time: 100, method: "GET" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		expect(quads.every((q) => q.namedGraph === OBSERVATION_GRAPH.EXTERNAL)).toBe(true);
		expect(quads.find((q) => q.predicate === "endpoint")).toBeUndefined(); // external isn't a registered route
		expect(from(quads)?.object).toBe("client");
		expect(to(quads)?.object).toBe("fonts.google.com");
		expect(quads.find((q) => q.subject === "fonts.google.com" && q.predicate === "type")?.object).toBe("as:Service"); // a destination lifeline
	});

	it("models an RPC/service call as a hidden-by-default client → site message, still reachable", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://localhost:8223/rpc/step.list", status: 200, time: 30, method: "POST" }, PATHS);
		const quads = extractQuadsFromEvents(emitted);
		expect(quads.every((q) => q.namedGraph === OBSERVATION_GRAPH.SERVICE)).toBe(true); // observation/shu-service is hidden by default
		expect(quads.find((q) => q.predicate === "endpoint")?.object).toBe("/rpc/:_method");
		expect(from(quads)?.object).toBe("client");
		expect(to(quads)?.object).toBe(activeSitePrincipal(world));
	});

	it("models an outbound (site-originated) request as a site → host message", async () => {
		const { world, emitted } = mockWorld();
		await trackHttpRequest(world, { url: "http://api.example.com/v1", status: 200, time: 40, method: "GET" }, PATHS, "site");
		const quads = extractQuadsFromEvents(emitted);
		expect(from(quads)?.object).toBe(activeSitePrincipal(world)); // the site made this call…
		expect(to(quads)?.object).toBe("api.example.com"); // …to an external host
	});
});
