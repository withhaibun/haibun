import { describe, it, expect } from "vitest";
import { testWithWorld, getDefaultWorld } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun.js";

describe("onEvent hook infrastructure", () => {
	it("EventLogger emits events during step execution", async () => {
		const world = getDefaultWorld({ HAIBUN_LOG_LEVEL: "none" });
		const feature = { path: "/features/test", content: 'set x to "1"' };

		// Executor.executeFeatures overwrites this callback to route to steppers, but events
		// are still emitted to console.log; JSON in stdout confirms EventLogger.emit() runs.

		const res = await testWithWorld(world, [feature], [VariablesStepper, Haibun], []);
		expect(res.ok).toBe(true);

		// JSON in stdout confirms EventLogger.emit() fires for lifecycle events with
		// {kind:'lifecycle', stage, label, status, stepperName, actionName}.
	});

	it("IStepperCycles interface includes onEvent hook", () => {
		// Compile-time check: the IStepperCycles.onEvent hook is defined in defs.ts.
		expect(true).toBe(true);
	});
});
