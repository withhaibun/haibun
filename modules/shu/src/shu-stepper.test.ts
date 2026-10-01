import { currentVersion } from "@haibun/core/currentVersion.js";
import { PAGE_ACTUALITY } from "./test-setup.js";
import { HYDRATION_ID } from "./consts.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { AUTHORITY_KEY, SessionAuthority } from "@haibun/core/lib/session-authority.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import ShuStepper, { buildSpaHtml } from "./shu-stepper.js";
import { EMBEDDER_ORIGIN_OPTION, mayFrame } from "./frame-ancestors.js";

describe("the app a deployment serves", () => {
	let stepper: ShuStepper;
	let world: TWorld;
	let addRoute: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		stepper = new ShuStepper();
		const mounted = new Set<string>();
		addRoute = vi.fn((_type: string, path: string) => {
			if (mounted.has(path)) throw new Error(`already mounted at "${path}"`);
			mounted.add(path);
		});
		world = getDefaultWorld();
		world.runtime[WEBSERVER] = { addRoute, mounted: { get: {} }, allowedWithoutDelegation: ["Read:public"] };
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

	it("tells the page what the deployment allows without a delegation, and whether a delegation verifies here, as each page is served", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const serve = addRoute.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
		const served = () => serve({ header: () => undefined, html: (body: string) => body });
		expect(served()).toContain('"allowedWithoutDelegation":["Read:public"],"verifiesDelegations":false');
		expect(served(), "and the build its code is from, so a deployment serving an old page is recognized").toMatch(
			new RegExp(`"build":\\{"version":"${currentVersion}","builtAt":"\\d{4}-\\d{2}-\\d{2}T`),
		);
		const authority = new SessionAuthority();
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

	it("lets only this site frame the page, and the embedding page's origin where the deployment names one", async () => {
		const EMBEDDER = "chrome-extension://abcdefghijklmnop";
		const headersOf = async (options: Record<string, string>) => {
			const served = new ShuStepper();
			const w = getDefaultWorld();
			w.moduleOptions = { ...w.moduleOptions, ...options };
			const routes = vi.fn();
			w.runtime[WEBSERVER] = { addRoute: routes, mounted: { get: {} }, allowedWithoutDelegation: [] };
			await served.setWorld(w, []);
			await served.steps.serveShuApp.action({ path: "/spa" });
			const serve = routes.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
			const headers: Record<string, string> = {};
			const page = serve({ header: (name: string, value: string) => (headers[name] = value), html: (body: string) => body });
			return { headers, page };
		};
		const own = (await headersOf({})).headers["Content-Security-Policy"];
		expect(own).toBe("frame-ancestors 'self'");
		expect(mayFrame(own ?? null, EMBEDDER), "a page that embeds shu reads that it may not").toBe(false);
		const embedded = await headersOf({ [getStepperOptionName(ShuStepper, "EMBEDDER_ORIGIN")]: EMBEDDER });
		expect(embedded.headers["Content-Security-Policy"]).toBe(`frame-ancestors 'self' ${EMBEDDER}`);
		expect(mayFrame(embedded.headers["Content-Security-Policy"] ?? null, EMBEDDER), "and reads that it may once the deployment names it").toBe(true);
		expect(embedded.page, "and the page reads the origin to accept messages from").toContain(`"embedderOrigin":"${EMBEDDER}"`);
		expect(new ShuStepper().options.EMBEDDER_ORIGIN.parse("an origin").parseError).toMatch(/isn't an origin/);
		expect(getStepperOptionName(ShuStepper, "EMBEDDER_ORIGIN"), "a page that can't frame shu names the option").toBe(EMBEDDER_ORIGIN_OPTION);
	});
});

describe("the page a deployment serves", () => {
	it("carries the timings the deployment set, so the page applies them from its first paint", () => {
		const page = buildSpaHtml("/spa", "/* bundle */", { actualityId: PAGE_ACTUALITY, settings: { streamReconnectAfterMs: 500 } });
		expect(page).toContain(`id="${HYDRATION_ID}"`);
		expect(page).toContain(JSON.stringify({ actualityId: PAGE_ACTUALITY, settings: { streamReconnectAfterMs: 500 } }));
	});

	it("doesn't carry a timing where the deployment didn't set one", () => {
		expect(buildSpaHtml("/spa", "/* bundle */", { actualityId: PAGE_ACTUALITY, settings: {} })).toContain(JSON.stringify({ actualityId: PAGE_ACTUALITY, settings: {} }));
	});
});
