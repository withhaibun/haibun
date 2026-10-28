import { testTempDir } from "@haibun/core/lib/test/temp-dir.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServerHono } from "./server-hono.js";
import { QuadStore, newStoreChain } from "@haibun/core/lib/quad-store.js";
import { EndpointLabels, misdirected, REQUEST_BODY_LIMIT_BYTES } from "../domains/web-server.js";
import type { TServing } from "../pipelines/server-settings.js";
import { PRODUCTION } from "@haibun/core/lib/domains/dev-mode.js";
import { whyNotSignedInOnly } from "./auth.js";
import { basicAuthUsers } from "@haibun/core/lib/domains/basic-auth.js";
import { eventHubOfTest, freePort } from "@haibun/core/lib/test/lib.js";
import { recordOf } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { storeDeclaring } from "@haibun/core/lib/test/declared-types.js";
import { ActionSchema } from "@haibun/core/lib/domains/actions.js";

const mockLogger = eventHubOfTest();

const P = { description: "test route" };
/** A server that names an empty list of origins and admits every visitor. */
const OPEN: TServing = { origins: [], allowedWithoutDelegation: [], admitted: [] };
/** The origin of a named server. */
const NAMED = "https://example.org";

describe("ServerHono", () => {
	let server: ServerHono;
	let store: QuadStore;

	beforeEach(() => {
		store = storeDeclaring({ [EndpointLabels.Endpoint]: {} });
		server = new ServerHono(mockLogger, "/tmp", () => store, OPEN);
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
			server.addRoute("get", "/sse", { ...P, service: true }, (c) => c.text("ok"));
			await settled();
			const ep = await recordOf(store, EndpointLabels.Endpoint, "/sse");
			expect(ep?.endpointClass).toBe("service");
		});

		it("persists a mounted route as a single Endpoint record with its descriptor", async () => {
			server.addRoute("get", "/.well-known/did.json", { description: "DID document resolution" }, (c) => c.text("ok"));
			await settled();
			const ep = await recordOf(store, EndpointLabels.Endpoint, "/.well-known/did.json");
			expect(ep?.url).toBe("/.well-known/did.json");
			expect(ep?.method).toBe("GET");
			expect(ep?.description).toBe("DID document resolution");
			expect(ep?.endpointClass).toBe("route");
			expect(ep?.generatedAtTime).toBeDefined();
		});
	});

	describe("addRpcMethods", () => {
		const read = { action: ActionSchema.parse("Fam:read"), handle: () => Promise.resolve("read") };

		it("serves a family's methods by their full names only, and records the family as a service Endpoint", async () => {
			server.addRpcMethods("fam.", { description: "a family" }, { read });
			expect(server.rpcMethod("fam.read")).toBe(read);
			expect(server.rpcMethod("fam.write"), "a name the family doesn't serve").toBeUndefined();
			expect(server.rpcMethod("other.read"), "a name outside every family").toBeUndefined();
			await new Promise((r) => setTimeout(r, 0));
			expect(await recordOf(store, EndpointLabels.Endpoint, "/rpc/fam.*")).toMatchObject({ description: "a family", endpointClass: "service" });
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
			expect(() => server.listen("test", -1)).toThrow("takes a port above 0");
			expect(() => server.listen("test", NaN)).toThrow("takes a port above 0");
		});

		it("listens on a free port and closes", async () => {
			const port = await freePort();
			await server.listen("test", port);
			expect(server.port).toBe(port);
			await server.close();
		});

		it("refuses a body past its limit before a route reads it", async () => {
			let read = false;
			server.addRoute("post", "/takes", P, async (c) => {
				read = true;
				return c.text(await c.req.text());
			});
			const answered = await server.app.request("/takes", { method: "POST", body: "x".repeat(REQUEST_BODY_LIMIT_BYTES + 1) });
			expect([answered.status, read]).toEqual([413, false]);
			expect((await server.app.request("/takes", { method: "POST", body: "within" })).status).toBe(200);
		});

		it("on any interface, serves a request addressed to a loopback name in development or to a named origin's host, and refuses a name that rebinds to the machine", async () => {
			const port = await freePort();
			const named = new ServerHono(mockLogger, "/tmp", () => store, { ...OPEN, origins: [NAMED] });
			named.addRoute("get", "/here", P, (c) => c.text("here"));
			await named.listen("test", port, "0.0.0.0");
			const addressedTo = async (host: string) => (await named.app.request(`http://${host}/here`)).status;
			expect([await addressedTo(`localhost:${port}`), await addressedTo(`127.0.0.1:${port}`), await addressedTo(`[::1]:${port}`), await addressedTo("example.org")]).toEqual([
				200, 200, 200, 200,
			]);
			expect([await addressedTo(`rebound.example:${port}`), await addressedTo(`127.0.0.1.rebound.example:${port}`), await addressedTo("example.org:8443")]).toEqual([
				421, 421, 421,
			]);
			const refused = await named.app.request("http://rebound.example/here");
			expect(await refused.text(), "the refusal names the hosts served and the remedy").toBe(misdirected([NAMED], "rebound.example"));
			await named.close();
		});

		it("in production, serves a request addressed to a named origin's host and not one addressed to a loopback name", async () => {
			vi.stubEnv("NODE_ENV", PRODUCTION);
			try {
				const named = new ServerHono(mockLogger, "/tmp", () => store, { ...OPEN, origins: [NAMED] });
				named.addRoute("get", "/here", P, (c) => c.text("here"));
				const addressedTo = async (host: string) => (await named.app.request(`http://${host}/here`)).status;
				expect([await addressedTo("example.org"), await addressedTo("localhost:8123")]).toEqual([200, 421]);
			} finally {
				vi.unstubAllEnvs();
			}
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
			expect(await recordOf(store, EndpointLabels.Endpoint, "/files")).toMatchObject({ method: "GET", description: "files a test serves" });
			expect(await recordOf(store, EndpointLabels.Endpoint, "/listing")).toMatchObject({ method: "GET", description: "an index a test serves" });
			expect(() => server.addKnownStaticFolder(tmpdir(), "/unstated", { description: "" })).toThrow("purpose.description is required");
		});

		it("serves only a folder its base holds, lists only what is under it, and lists a name as text", async () => {
			const base = testTempDir("served-");
			mkdirSync(join(base, "shown"));
			writeFileSync(join(base, "shown", "<b>named.txt"), "");
			const held = new ServerHono(mockLogger, base, () => store, OPEN);
			expect(() => held.checkAddStaticFolder("../..", "/out", P)).toThrow(`ServerHono: ../.. leads out of ${base}`);
			expect(() => held.checkAddIndexFolder("..", "/out", P)).toThrow(`ServerHono: .. leads out of ${base}`);
			held.checkAddIndexFolder("shown", "/listing", P);
			const listing = await (await held.app.request("/listing/")).text();
			expect(listing).toContain("&lt;b&gt;named.txt");
			expect(listing).not.toContain("<b>");
			expect((await held.app.request("/listing/%2e%2e/%2e%2e/")).status, "a request that leads out of the folder").toBe(404);
		});

		it("gates the files a folder at the root holds, and passes a request for a route beside it to that route", async () => {
			const base = testTempDir("rooted-");
			writeFileSync(join(base, "page.html"), "a page");
			const rooted = new ServerHono(mockLogger, base, () => store, OPEN);
			rooted.checkAddStaticFolder(".", "/", P, (c) => Promise.resolve(c.text("held back", 403)));
			rooted.addRoute("get", "/beside", P, (c) => c.text("beside"));
			expect((await rooted.app.request("/page.html")).status, "a file the folder holds").toBe(403);
			expect(await (await rooted.app.request("/beside")).text(), "a route mounted after the folder").toBe("beside");
		});

		it("serves a request for a folder only once the folder's gates pass it", async () => {
			server.addKnownStaticFolder(tmpdir(), "/held", { description: "files a gate holds" }, (c) => Promise.resolve(c.text("held back", 403)));
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
	/** The origin of these servers. */
	const SITE = "https://site.test";
	const signIn = (entry: string) => ({ authorization: `Basic ${Buffer.from(entry).toString("base64")}` });
	const serving = () => {
		const server = new ServerHono(mockLogger, "/tmp", () => new QuadStore(newStoreChain()), { ...OPEN, origins: [SITE], admitted: basicAuthUsers(ADMITTED) });
		server.addRoute("get", "/held", { description: "a route every feature might add" }, (c) => c.text("held"));
		return server.app;
	};

	it("refuses a request that doesn't sign in 401, on every route, before the route reads it", async () => {
		expect((await serving().request("/held")).status).toBe(401);
		expect((await serving().request("/a-route-a-later-feature-adds")).status).toBe(401);
		expect((await serving().request("/held", { headers: signIn("reader:another-password") })).status).toBe(401);
	});

	it("serves a request that signs in", async () => {
		expect(await (await serving().request("/held", { headers: signIn(ADMITTED) })).text()).toBe("held");
	});

	it("still requires a sign-in after a feature's routes are cleared, since the next feature's routes are as held", async () => {
		const server = new ServerHono(mockLogger, "/tmp", () => new QuadStore(newStoreChain()), { ...OPEN, admitted: basicAuthUsers(ADMITTED) });
		server.clearMounted();
		expect((await server.app.request("/held")).status).toBe(401);
	});

	it("passes the check that an address requires every visitor to sign in, which an open server fails with what to change", async () => {
		const asking = serving();
		expect(await whyNotSignedInOnly("https://site.test/held", (at) => Promise.resolve(asking.request(at)))).toBeUndefined();
		const open = new ServerHono(mockLogger, "/tmp", () => new QuadStore(newStoreChain()), { ...OPEN, origins: [SITE] });
		open.addRoute("get", "/held", { description: "a route anyone reaches" }, (c) => c.text("held"));
		expect(await whyNotSignedInOnly("https://site.test/held", (at) => Promise.resolve(open.app.request(at)))).toBe(
			"https://site.test/held returned 200 without a sign-in; it must return 401. Put basic auth on its proxy, or set the web server's BASIC_AUTH option.",
		);
		expect(await whyNotSignedInOnly("https://site.test/held", () => Promise.reject(new Error("getaddrinfo ENOTFOUND site.test")))).toBe(
			"Couldn't check that https://site.test/held requires visitors to sign in: getaddrinfo ENOTFOUND site.test. Check the address and that its proxy is running.",
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
