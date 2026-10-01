import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { ServerHono } from "./server-hono.js";
import type { IEventLogger } from "@haibun/core/lib/EventLogger.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { EndpointLabels } from "./defs.js";
import { whyNotSignedInOnly } from "./auth.js";
import { basicAuthUsers } from "@haibun/core/lib/basic-auth.js";

const mockLogger: IEventLogger = {
	subscribe: () => {
		/* noop */
	},
	unsubscribe: () => {
		/* noop */
	},
	hasSubscribers: () => false,
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
		server = new ServerHono(mockLogger, "/tmp", () => store, []);
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

	describe("addRpcMethods", () => {
		const read = { action: "Fam:read", handle: () => Promise.resolve("read") };

		it("serves a family's methods by their full names only, and records the family as a service Endpoint", async () => {
			server.addRpcMethods("fam.", { description: "a family" }, { read });
			expect(server.rpcMethod("fam.read")).toBe(read);
			expect(server.rpcMethod("fam.write"), "a name the family doesn't serve").toBeUndefined();
			expect(server.rpcMethod("other.read"), "a name outside every family").toBeUndefined();
			await new Promise((r) => setTimeout(r, 0));
			expect(await store.getIndividual<Record<string, unknown>>(EndpointLabels.Endpoint, "/rpc/fam.*")).toMatchObject({ description: "a family", endpointClass: "service" });
		});

		it("refuses a prefix that doesn't end in a dot, and a family already served", () => {
			expect(() => server.addRpcMethods("fam", P, { read })).toThrow('a family\'s prefix ends in ".", not "fam"');
			server.addRpcMethods("fam.", P, { read });
			expect(() => server.addRpcMethods("fam.", P, { read })).toThrow("the fam. family is already served");
		});

		it("goes with the feature's mounts", () => {
			server.addRpcMethods("fam.", P, { read });
			server.clearMounted();
			expect(server.rpcMethod("fam.read")).toBeUndefined();
		});
	});

	it("doesn't serve a route that ends the process, since ending it is a step that takes WebServer:stop", async () => {
		expect((await server.app.request("/stop", { method: "POST" })).status).toBe(404);
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
			expect(() => server.checkAddStaticFolder("", "/static", P)).toThrow("relativeFolder is required");
		});

		it("throws if mountAt missing", () => {
			expect(() => server.checkAddStaticFolder("public", "", P)).toThrow("mountAt is required");
		});

		it("records a folder it serves as an Endpoint with its purpose, as a route is, and refuses one without a purpose", async () => {
			server.addKnownStaticFolder(tmpdir(), "/files", { description: "files a test serves" });
			server.checkAddIndexFolder(".", "/listing", { description: "an index a test serves" });
			await new Promise((r) => setTimeout(r, 0)); // the mount's persist is fire-and-forget
			expect(await store.getIndividual(EndpointLabels.Endpoint, "/files")).toMatchObject({ method: "GET", description: "files a test serves" });
			expect(await store.getIndividual(EndpointLabels.Endpoint, "/listing")).toMatchObject({ method: "GET", description: "an index a test serves" });
			expect(() => server.addKnownStaticFolder(tmpdir(), "/unstated", { description: "" })).toThrow("purpose.description is required");
		});

		it("answers a request for a folder it serves only once the folder's gates pass it", async () => {
			server.addKnownStaticFolder(tmpdir(), "/held", { description: "files a gate holds" }, (c) => c.text("held back", 403));
			for (const path of ["/held", "/held/any.png"]) {
				const answered = await server.app.request(path);
				expect(answered.status, path).toBe(403);
				expect(await answered.text()).toBe("held back");
			}
		});
	});
});

describe("a server that admits people by basic auth", () => {
	const ADMITTED = "reader:a-password-for-this-test";
	const signIn = (entry: string) => ({ authorization: `Basic ${Buffer.from(entry).toString("base64")}` });
	const serving = () => {
		const server = new ServerHono(mockLogger, "/tmp", () => new QuadStore(), [], basicAuthUsers(ADMITTED));
		server.addRoute("get", "/held", { description: "a route every feature might add" }, (c) => c.text("held"));
		return server.app;
	};

	it("refuses a request that doesn't sign in 401, on every route, before the route reads it", async () => {
		expect((await serving().request("/held")).status).toBe(401);
		expect((await serving().request("/a-route-a-later-feature-adds")).status).toBe(401);
		expect((await serving().request("/held", { headers: signIn("reader:another-password") })).status).toBe(401);
	});

	it("answers a request that signs in", async () => {
		expect(await (await serving().request("/held", { headers: signIn(ADMITTED) })).text()).toBe("held");
	});

	it("still asks after a feature's routes are cleared, since the next feature's routes are as held", async () => {
		const server = new ServerHono(mockLogger, "/tmp", () => new QuadStore(), [], basicAuthUsers(ADMITTED));
		server.clearMounted();
		expect((await server.app.request("/held")).status).toBe(401);
	});

	it("passes the check that an address asks every visitor to sign in, which a server that doesn't ask fails with what to change", async () => {
		const asking = serving();
		expect(await whyNotSignedInOnly("https://site.test/held", (at) => Promise.resolve(asking.request(at)))).toBeUndefined();
		const open = new ServerHono(mockLogger, "/tmp", () => new QuadStore(), []);
		open.addRoute("get", "/held", { description: "a route anyone reaches" }, (c) => c.text("held"));
		expect(await whyNotSignedInOnly("https://site.test/held", (at) => Promise.resolve(open.app.request(at)))).toBe(
			"https://site.test/held answered 200 without a sign-in; it must answer 401. Put basic auth on its proxy, or set the web server's BASIC_AUTH option.",
		);
		expect(await whyNotSignedInOnly("https://site.test/held", () => Promise.reject(new Error("getaddrinfo ENOTFOUND site.test")))).toBe(
			"Couldn't check that https://site.test/held asks visitors to sign in: getaddrinfo ENOTFOUND site.test. Check the address and that its proxy is running.",
		);
	});

	it("names people by user:password entries, and refuses an entry that isn't one without repeating it", () => {
		expect(basicAuthUsers("reader:one,writer:two:with-a-colon")).toEqual([
			{ username: "reader", password: "one" },
			{ username: "writer", password: "two:with-a-colon" },
		]);
		expect(() => basicAuthUsers("reader:one,a-secret-without-a-user")).toThrow("basic auth entry 2 isn't user:password");
	});
});
