import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import { AUTHORITY_KEY, SessionAuthority } from "@haibun/core/lib/session-authority.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import ShuStepper, { buildSpaHtml } from "./shu-stepper.js";

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
		expect(served()).toContain(JSON.stringify({ settings: { allowedWithoutDelegation: ["Read:public"], verifiesDelegations: false } }));
		const authority = new SessionAuthority();
		const recordsNothing = async () => ({ ok: false as const, error: "records nothing" });
		authority.registerVerifier({ verify: async () => ({ ok: false }), delegationsTo: async () => ({ delegations: [] }), record: recordsNothing, revoke: recordsNothing });
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
		expect((await headersOf({})).headers["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
		const embedded = await headersOf({ [getStepperOptionName(ShuStepper, "EMBEDDER_ORIGIN")]: EMBEDDER });
		expect(embedded.headers["Content-Security-Policy"]).toBe(`frame-ancestors 'self' ${EMBEDDER}`);
		expect(embedded.page, "and the page reads the origin to accept messages from").toContain(`"embedderOrigin":"${EMBEDDER}"`);
		expect(new ShuStepper().options.EMBEDDER_ORIGIN.parse("an origin").parseError).toMatch(/isn't an origin/);
	});
});

describe("the page a deployment serves", () => {
	it("carries the timings the deployment set, so the page applies them from its first paint", () => {
		const page = buildSpaHtml("/spa", "/* bundle */", { streamReconnectAfterMs: 500 });
		expect(page).toContain('id="shu-hydration"');
		expect(page).toContain(JSON.stringify({ settings: { streamReconnectAfterMs: 500 } }));
	});

	it("carries no timing where the deployment set none", () => {
		expect(buildSpaHtml("/spa", "/* bundle */")).toContain(JSON.stringify({ settings: {} }));
	});
});
