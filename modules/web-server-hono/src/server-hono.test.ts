import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ServerHono } from "./server-hono.js";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { EndpointLabels } from "./defs.js";

const mockLogger: IEventLogger = {
	currentSeqPath: undefined,
	subscribe: () => {
		/* noop */
	},
	unsubscribe: () => {
		/* noop */
	},
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

const P = { description: "test route" };

describe("ServerHono", () => {
	let server: ServerHono;
	let store: QuadStore;

	beforeEach(() => {
		store = new QuadStore();
		server = new ServerHono(mockLogger, "/tmp", () => store);
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
			server.addRoute("get", "/test", P, (c) => c.text("ok"));
			expect(server.mounted.get["/test"]).toBeDefined();
		});

		it("throws on duplicate route", () => {
			server.addRoute("get", "/test", P, (c) => c.text("ok"));
			expect(() => server.addRoute("get", "/test", P, (c) => c.text("ok2"))).toThrow("already mounted");
		});

		it("throws on invalid path characters", () => {
			expect(() => server.addRoute("get", "/test<script>", P, (c) => c.text("ok"))).toThrow("illegal characters");
		});

		it("throws when purpose is missing", () => {
			expect(() => (server as unknown as { addRoute: (...a: unknown[]) => void }).addRoute("get", "/test2", undefined, (c: unknown) => c)).toThrow(
				"purpose.description is required",
			);
		});

		it("throws when purpose.description is empty", () => {
			expect(() => server.addRoute("get", "/test3", { description: "" }, (c) => c.text("ok"))).toThrow("purpose.description is required");
		});

		it("allows path parameters", () => {
			server.addRoute("get", "/users/:id", P, (c) => c.text("ok"));
			expect(server.mounted.get["/users/:id"]).toBeDefined();
		});

		it("allows .well-known paths with single dot", () => {
			server.addRoute("get", "/.well-known/context.jsonld", P, (c) => c.text("ok"));
			expect(server.mounted.get["/.well-known/context.jsonld"]).toBeDefined();
		});

		it("throws on path traversal with double dots", () => {
			expect(() => server.addRoute("get", "/../../etc/passwd", P, (c) => c.text("ok"))).toThrow("multiple dots");
		});

		it("throws on double dot in any segment", () => {
			expect(() => server.addRoute("get", "/safe/../secret", P, (c) => c.text("ok"))).toThrow("multiple dots");
		});

		it("throws on multiple dots in filename", () => {
			expect(() => server.addRoute("get", "/path/file..ext", P, (c) => c.text("ok"))).toThrow("multiple dots");
		});

		const settled = () => new Promise((r) => setTimeout(r, 0)); // let the mount's fire-and-forget persist complete

		it("persists a service route as an Endpoint record classed 'service'", async () => {
			server.addRoute("get", "/sse", P, (c) => c.text("ok"));
			await settled();
			const ep = await store.getIndividual<Record<string, unknown>>(EndpointLabels.Endpoint, "/sse");
			expect(ep?.endpointClass).toBe("service");
		});

		it("persists a mounted route as a single Endpoint record with its descriptor", async () => {
			server.addRoute("get", "/.well-known/did.json", { description: "DID document resolution" }, (c) => c.text("ok"));
			await settled();
			const ep = await store.getIndividual<Record<string, unknown>>(EndpointLabels.Endpoint, "/.well-known/did.json");
			expect(ep?.url).toBe("/.well-known/did.json");
			expect(ep?.method).toBe("GET");
			expect(ep?.description).toBe("DID document resolution");
			expect(ep?.endpointClass).toBe("route");
			expect(ep?.generatedAtTime).toBeDefined();
		});
	});

	describe("addKnownRoute", () => {
		it("adds route without path validation", () => {
			server.addKnownRoute("post", "/internal", P, (c) => c.text("ok"));
			expect(server.mounted.post["/internal"]).toBeDefined();
		});
	});

	describe("clearMounted", () => {
		it("resets mounted map and allows re-registration", () => {
			server.addRoute("get", "/test", P, (c) => c.text("ok"));
			expect(server.mounted.get["/test"]).toBeDefined();
			server.clearMounted();
			expect(server.mounted.get["/test"]).toBeUndefined();
			server.addRoute("get", "/test", P, (c) => c.text("ok2"));
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
