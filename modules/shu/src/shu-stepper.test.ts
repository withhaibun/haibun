import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { WEBSERVER } from "@haibun/web-server-hono/defs.js";
import ShuStepper from "./shu-stepper.js";

describe("ShuStepper", () => {
	let stepper: ShuStepper;
	let addRoute: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		stepper = new ShuStepper();
		addRoute = vi.fn();
		const world = getDefaultWorld();
		world.runtime[WEBSERVER] = { addRoute };
		await stepper.setWorld(world, []);
	});

	it("rejects invalid mount paths", async () => {
		const result = await stepper.steps.serveShuApp.action({ path: "spa" });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected invalid mount path to fail");
		expect(result.errorMessage).toContain('path must start with "/"');
		expect(addRoute).not.toHaveBeenCalled();
	});

	it("idempotent mount at same path succeeds", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(first.ok).toBe(true);
		const firstCallCount = addRoute.mock.calls.length;
		expect(firstCallCount).toBeGreaterThanOrEqual(1);

		const second = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(second.ok).toBe(true);
		expect(addRoute).toHaveBeenCalledTimes(firstCallCount);
	});

	it("rejects mounting the app at a second path", async () => {
		const first = await stepper.steps.serveShuApp.action({ path: "/spa" });
		expect(first.ok).toBe(true);
		const firstCallCount = addRoute.mock.calls.length;

		const second = await stepper.steps.serveShuApp.action({ path: "/alt" });
		expect(second.ok).toBe(false);
		if (second.ok) throw new Error("expected second mount path to fail");
		expect(second.errorMessage).toContain('already mounted at "/spa"');
		expect(addRoute).toHaveBeenCalledTimes(firstCallCount);
	});
});
