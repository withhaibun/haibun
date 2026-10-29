import { currentVersion } from "@haibun/core/lib/adapters/current-version.js";
import { PAGE_ACTUALITY, SERVED_SETTINGS, servedWith } from "./test/setup.js";
import { CONTEXT_DOCUMENT, HYDRATION_ID, SHU_TAG } from "./domains/elements.js";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { WEBSERVER } from "@haibun/web-server-hono/domains/web-server.js";
import { SessionAuthority } from "@haibun/core/lib/pipelines/session-authority.js";
import { AUTHORITY_KEY } from "@haibun/core/lib/domains/session-authority.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { LinkRelations, commentDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { registerDomains } from "@haibun/core/lib/domains/domains.js";
import ShuStepper from "./shu-stepper.js";
import { buildSpaHtml } from "./derivations/page-html.js";
import { mayFrame } from "./derivations/content-security-policy.js";
import { EMBEDDER_ORIGIN_OPTION, PAGE_ASSETS, PAGE_BUNDLE_JS } from "./domains/serving.js";
import { gunzipSync } from "node:zlib";
import { actualityClock } from "@haibun/core/lib/actuality/root.js";

/** A page's script nonce, as a test states one. */
const NONCE = "a-test-nonce";

/** A web server as the stepper reaches it: each route added through `addRoute`, and a route already added left as it is. */
/** A route added to a web server: its method, its path, and how it is described and handled. */
type TAddRoute = Mock<(type: string, path: string, ...rest: unknown[]) => void>;

const fakeServer = (addRoute: TAddRoute, allowedWithoutDelegation: string[]) => ({
	addRoute,
	addRouteIfAbsent: (type: string, path: string, ...rest: unknown[]) => {
		if (!addRoute.mock.calls.some(([, added]) => added === path)) addRoute(type, path, ...rest);
	},
	mounted: { get: {} },
	allowedWithoutDelegation,
	origins: [],
});

describe("the app a deployment serves", () => {
	let stepper: ShuStepper;
	let world: TWorld;
	let addRoute: TAddRoute;

	beforeEach(async () => {
		stepper = new ShuStepper();
		const mounted = new Set<string>();
		addRoute = vi.fn((_type: string, path: string, ..._rest: unknown[]) => {
			if (mounted.has(path)) throw new Error(`already mounted at "${path}"`);
			mounted.add(path);
		});
		world = getDefaultWorld();
		world.runtime[WEBSERVER] = fakeServer(addRoute, ["Read:public"]);
		await stepper.setWorld(world, []);
	});

	it("rejects invalid mount paths", async () => {
		const result = await stepper.steps.serveShuApp.action({ path: "spa" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected invalid mount path to fail");
		expect(result.errorMessage).toContain('path must start with "/"');
		expect(addRoute).not.toHaveBeenCalled();
	});

	it("throws on duplicate mount at same path", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(first.ok).toBe(true);
		expect(() => stepper.steps.serveShuApp.action({ path: "/spa" })).toThrow("already mounted");
	});

	it("serves a page with the address it opens at, where its server states one", () => {
		const OPENS_AT = "#?col=shu-monitor-column";
		const servedAt = (path: string): string => {
			const route = addRoute.mock.calls.find(([, at]) => at === path);
			if (!route) throw new Error(`the stepper didn't add a route at ${path}`);
			return (route[3] as (c: unknown) => string)({ header: () => undefined, html: (body: string) => body });
		};
		const server = world.runtime[WEBSERVER] as Parameters<ShuStepper["serveApp"]>[0];
		stepper.serveApp(server, "/monitor", OPENS_AT);
		stepper.serveApp(server, "/spa");
		expect(servedAt("/monitor")).toContain(`"viewHash":"${OPENS_AT}"`);
		expect(servedAt("/spa"), "a page served without one opens as its reader or actuality arranges").not.toContain('"viewHash"');
	});

	it("sends the page what the deployment allows without a delegation, and whether a delegation verifies here, as each page is served", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const serve = addRoute.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
		const served = () => serve({ header: () => undefined, html: (body: string) => body });
		expect(served()).toContain('"allowedWithoutDelegation":["Read:public"],"verifiesDelegations":false');
		expect(served(), "and the build its code is from, so a deployment serving an old page is recognized").toMatch(
			new RegExp(`"build":\\{"version":"${currentVersion}","builtAt":"\\d{4}-\\d{2}-\\d{2}T`),
		);
		const authority = new SessionAuthority(actualityClock());
		const recordsNothing = async () => ({ ok: false as const, error: "records nothing" });
		authority.registerVerifier({
			verify: async () => ({ ok: false as const, error: "the stand-in refuses every proof" }),
			delegationsTo: async () => ({ delegations: [] }),
			record: recordsNothing,
			revoke: recordsNothing,
		});
		(world.runtime.keys ??= {})[AUTHORITY_KEY] = authority;
		expect(served(), "a verifier registered after the app was served").toContain('"verifiesDelegations":true');
	});

	it("serves the JSON-LD context of the domains as they stand, so a type declared after the app was served is in it", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const route = addRoute.mock.calls.find(([, path]) => path === CONTEXT_DOCUMENT.wellKnown);
		if (!route) throw new Error("the stepper didn't serve the JSON-LD context");
		const served = () => JSON.stringify((route[3] as (c: unknown) => unknown)({ req: { header: () => ({ host: "site.test" }) }, json: (body: unknown) => body }));
		expect(served()).not.toContain("exv:Declared");
		world.domains = {
			...world.domains,
			declared: {
				topology: { persistedAs: "Declared", type: "exv:Declared", id: "id", namespaces: { exv: "https://vocab.example/ns#" }, properties: { id: LinkRelations.IDENTIFIER.rel } },
			},
		} as unknown as TWorld["domains"];
		expect(served()).toContain("exv:Declared");
	});

	it("lets only this site frame the page, and the embedding page's origin where the deployment names one", async () => {
		const EMBEDDER = "chrome-extension://abcdefghijklmnop";
		const headersOf = async (options: Record<string, string>) => {
			const served = new ShuStepper();
			const w = getDefaultWorld();
			w.moduleOptions = { ...w.moduleOptions, ...options };
			const routes: TAddRoute = vi.fn();
			w.runtime[WEBSERVER] = fakeServer(routes, []);
			await served.setWorld(w, []);
			await served.steps.serveShuApp.action({ path: "/spa" });
			const serve = routes.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
			const headers: Record<string, string> = {};
			const page = serve({ header: (name: string, value: string) => (headers[name] = value), html: (body: string) => body });
			return { headers, page };
		};
		const own = (await headersOf({})).headers["Content-Security-Policy"];
		expect(own).toMatch(/^frame-ancestors 'self'; script-src /);
		expect(mayFrame(own ?? null, EMBEDDER), "a page that embeds shu reads that it may not").toBe(false);
		const embedded = await headersOf({ [getStepperOptionName(ShuStepper, "EMBEDDER_ORIGIN")]: EMBEDDER });
		expect(embedded.headers["Content-Security-Policy"]).toMatch(new RegExp(`^frame-ancestors 'self' ${EMBEDDER}; script-src `));
		expect(mayFrame(embedded.headers["Content-Security-Policy"] ?? null, EMBEDDER), "and reads that it may once the deployment names it").toBe(true);
		expect(embedded.page, "and the page reads the origin to accept messages from").toContain(`"embedderOrigin":"${EMBEDDER}"`);
		expect(new ShuStepper().options.EMBEDDER_ORIGIN.parse("an origin").parseError).toMatch(/isn't an origin/);
		expect(getStepperOptionName(ShuStepper, "EMBEDDER_ORIGIN"), "a page that can't frame shu names the option").toBe(EMBEDDER_ORIGIN_OPTION);
	});

	it("serves the page's bundle with an ETag, gzipped where the request accepts gzip, a 304 for an unchanged one, and a 404 for a file the build didn't write", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const serve = addRoute.mock.calls.find(([, path]) => path === `${PAGE_ASSETS}/:file`)?.[3] as (c: unknown) => Response;
		const request = (file: string, headers: Record<string, string>) => {
			const sent: Record<string, string> = {};
			const c = {
				req: { path: `${PAGE_ASSETS}/${file}`, header: (name: string) => headers[name] },
				header: (name: string, value: string) => (sent[name] = value),
				body: (body: unknown, status = 200) => ({ body, status }),
			};
			return { answer: serve(c) as unknown as { body: unknown; status: number }, sent };
		};
		const bundle = PAGE_BUNDLE_JS.slice(PAGE_ASSETS.length + 1);
		const gzipped = request(bundle, { "accept-encoding": "gzip, deflate" });
		expect(gzipped.sent["Content-Encoding"]).toBe("gzip");
		expect(gunzipSync(gzipped.answer.body as Uint8Array).toString("utf-8")).toBe(request(bundle, {}).answer.body);
		expect(request(bundle, { "if-none-match": gzipped.sent.ETag ?? "" }).answer.status).toBe(304);
		expect(request("absent.js", {}).answer.status).toBe(404);
	});

	it("runs the script it serves with the response's nonce, which the response's policy names, and a nonce of its own for each response", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const serve = addRoute.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
		const respond = () => {
			const headers: Record<string, string> = {};
			const page = serve({ header: (name: string, value: string) => (headers[name] = value), html: (body: string) => body });
			const nonce = /script-src 'nonce-([^']+)'/.exec(headers["Content-Security-Policy"] ?? "")?.[1];
			return { page, nonce };
		};
		const first = respond();
		expect(first.page, "the page's script carries the nonce its policy names").toContain(`<script type="module" nonce="${first.nonce}" src="${PAGE_BUNDLE_JS}">`);
		expect(first.page.match(/ nonce=/g), "and only that script").toHaveLength(1);
		expect(respond().nonce, "a second response names another").not.toBe(first.nonce);
	});
});

describe("the page a deployment serves", () => {
	it("carries the timings the deployment set, so the page applies them from its first paint", () => {
		const page = buildSpaHtml("/spa", { actualityId: PAGE_ACTUALITY, settings: servedWith({ streamReconnectAfterMs: 500 }) }, NONCE);
		expect(page).toContain(`id="${HYDRATION_ID}"`);
		expect(page).toContain(JSON.stringify({ actualityId: PAGE_ACTUALITY, settings: servedWith({ streamReconnectAfterMs: 500 }) }));
	});

	it("doesn't carry a timing where the deployment didn't set one", () => {
		expect(buildSpaHtml("/spa", { actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS }, NONCE)).toContain(
			JSON.stringify({ actualityId: PAGE_ACTUALITY, settings: SERVED_SETTINGS }),
		);
	});
});

describe("what a deployment's shu reads of itself", () => {
	let stepper: ShuStepper;
	let world: TWorld;

	beforeEach(async () => {
		stepper = new ShuStepper();
		world = getDefaultWorld();
		world.runtime[WEBSERVER] = fakeServer(
			vi.fn(() => undefined),
			["Read:public"],
		);
		await stepper.setWorld(world, []);
		registerDomains(world, [[...(stepper.cycles.getConcerns().domains ?? []), commentDomainDefinition]]);
	});

	it("lists the path of each app it serves", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect((await stepper.steps.showShuApps.action()).products).toEqual({ apps: [{ path: "/spa" }], total: 1, saturated: false });
	});

	it("declares the class browser and the views picker as views, which the Domain records list with their components", () => {
		expect(world.domains[SHU_TAG.CLASS_BROWSER]?.ui?.component).toBe(SHU_TAG.CLASS_BROWSER);
		expect(world.domains[SHU_TAG.VIEWS_PICKER]?.ui?.component).toBe(SHU_TAG.VIEWS_PICKER);
	});

	it("states where its graph view placed each node, for the graph the store holds", async () => {
		const read = await stepper.steps.getGraphLayout.action();
		expect(read.ok, read.ok ? "" : read.errorMessage).toBe(true);
		expect(read.products).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array), clusters: expect.any(Array) });
	});
});
