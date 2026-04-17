import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ServerHono } from "./server-hono.js";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { OBSERVATION_GRAPH } from "@haibun/core/lib/http-observations.js";

const mockLogger: IEventLogger = {
	info: () => {
		/* noop */
	},
	warn: () => {
		/* noop */
	},
	error: () => {
		/* noop */
	},
	debug: () => {
		/* noop */
	},
	artifact: () => {
		/* noop */
	},
	emit: () => {
		/* noop */
	},
	log: () => {
		/* noop */
	},
	stepStart: () => {
		/* noop */
	},
	stepEnd: () => {
		/* noop */
	},
};

describe("ServerHono", () => {
	let server: ServerHono;

	beforeEach(() => {
		server = new ServerHono(mockLogger, "/tmp");
	});

	afterEach(async () => {
		await server.close();
	});

	describe("constructor", () => {
		it("creates Hono app", () => {
			expect(server.app).toBeDefined();
		});
	});

	describe("addRoute", () => {
		it("adds GET route", () => {
			server.addRoute("get", "/test", (c) => c.text("ok"));
			expect(server.mounted.get["/test"]).toBeDefined();
		});

		it("throws on duplicate route", () => {
			server.addRoute("get", "/test", (c) => c.text("ok"));
			expect(() => server.addRoute("get", "/test", (c) => c.text("ok2"))).toThrow("already mounted");
		});

		it("throws on invalid path characters", () => {
			expect(() => server.addRoute("get", "/test<script>", (c) => c.text("ok"))).toThrow("illegal characters");
		});

		it("allows path parameters", () => {
			server.addRoute("get", "/users/:id", (c) => c.text("ok"));
			expect(server.mounted.get["/users/:id"]).toBeDefined();
		});

		it("allows .well-known paths with single dot", () => {
			server.addRoute("get", "/.well-known/context.jsonld", (c) => c.text("ok"));
			expect(server.mounted.get["/.well-known/context.jsonld"]).toBeDefined();
		});

		it("throws on path traversal with double dots", () => {
			expect(() => server.addRoute("get", "/../../etc/passwd", (c) => c.text("ok"))).toThrow("multiple dots");
		});

		it("throws on double dot in any segment", () => {
			expect(() => server.addRoute("get", "/safe/../secret", (c) => c.text("ok"))).toThrow("multiple dots");
		});

		it("throws on multiple dots in filename", () => {
			expect(() => server.addRoute("get", "/path/file..ext", (c) => c.text("ok"))).toThrow("multiple dots");
		});

		it("emits shu-service quad for internal routes", async () => {
			const emitted: unknown[] = [];
			const capturingLogger = { ...mockLogger, emit: (e: unknown) => emitted.push(e) };
			const s = new ServerHono(capturingLogger, "/tmp");
			s.addRoute("get", "/sse", (c) => c.text("ok"));
			const event = emitted.find((e) => (e as Record<string, unknown>).id?.toString().startsWith("quad-endpoint-"));
			const json = (event as Record<string, Record<string, Record<string, unknown>>>).json;
			expect(json.quadObservation.namedGraph).toBe(OBSERVATION_GRAPH.SERVICE);
			await s.close();
		});

		it("emits endpoint quad on addRoute", async () => {
			const emitted: unknown[] = [];
			const capturingLogger = { ...mockLogger, emit: (e: unknown) => emitted.push(e) };
			const s = new ServerHono(capturingLogger, "/tmp");
			s.addRoute("get", "/.well-known/did.json", (c) => c.text("ok"));
			const endpointEvent = emitted.find((e) => (e as Record<string, unknown>).id?.toString().startsWith("quad-endpoint-"));
			expect(endpointEvent).toBeDefined();
			const json = (endpointEvent as Record<string, Record<string, Record<string, unknown>>>).json;
			expect(json.quadObservation.subject).toBe("/.well-known/did.json");
			expect(json.quadObservation.namedGraph).toBe("Endpoint");
			expect(json.quadObservation.object).toBe("GET /.well-known/did.json");
			await s.close();
		});
	});

	describe("addKnownRoute", () => {
		it("adds route without path validation", () => {
			server.addKnownRoute("post", "/internal", (c) => c.text("ok"));
			expect(server.mounted.post["/internal"]).toBeDefined();
		});
	});

	describe("clearMounted", () => {
		it("resets mounted map and allows re-registration", () => {
			server.addRoute("get", "/test", (c) => c.text("ok"));
			expect(server.mounted.get["/test"]).toBeDefined();
			server.clearMounted();
			expect(server.mounted.get["/test"]).toBeUndefined();
			server.addRoute("get", "/test", (c) => c.text("ok2"));
			expect(server.mounted.get["/test"]).toBeDefined();
		});
	});

	describe("listen/close", () => {
		it("throws on invalid port", () => {
			expect(() => server.listen("test", -1)).toThrow("invalid port");
			expect(() => server.listen("test", NaN)).toThrow("invalid port");
		});

		it("listens on dynamic port and closes", async () => {
			// Use a high port to avoid conflicts
			const dynamicPort = 10000 + Math.floor(Math.random() * 50000);
			await server.listen("test", dynamicPort);
			expect(server.port).toBe(dynamicPort);
			await server.close();
		});
	});

	describe("checkAddStaticFolder", () => {
		it("throws if folder missing", () => {
			expect(() => server.checkAddStaticFolder("", "/static")).toThrow("relativeFolder is required");
		});

		it("throws if mountAt missing", () => {
			expect(() => server.checkAddStaticFolder("public", "")).toThrow("mountAt is required");
		});
	});
});
