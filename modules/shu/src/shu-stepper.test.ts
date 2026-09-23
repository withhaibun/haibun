import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import ShuStepper, { buildSpaHtml } from "./shu-stepper.js";

describe("the app a deployment serves", () => {
	let stepper: ShuStepper;
	let addRoute: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		stepper = new ShuStepper();
		const mounted = new Set<string>();
		addRoute = vi.fn((_type: string, path: string) => {
			if (mounted.has(path)) throw new Error(`already mounted at "${path}"`);
			mounted.add(path);
		});
		const world = getDefaultWorld();
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

	it("tells the page what the deployment allows without a delegation, so it knows what needs no signing", async () => {
		await stepper.steps.serveShuApp.action({ path: "/spa" });
		const serve = addRoute.mock.calls.find(([, path]) => path === "/spa")?.[3] as (c: unknown) => string;
		const page = serve({ header: () => undefined, html: (body: string) => body });
		expect(page).toContain(JSON.stringify({ settings: { allowedWithoutDelegation: ["Read:public"] } }));
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
