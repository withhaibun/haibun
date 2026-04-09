import { describe, expect, it } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import LogicStepper from "./logic-stepper.js";
import Haibun from "./haibun.js";
import FinalizerStepper from "./finalizer-stepper.js";

describe("finalizer-stepper", () => {
	it("registers and runs one statement per finalizer step", async () => {
		const result = await passWithDefaults(
			[
				{
					path: "/features/main.feature",
					content:
						"set counterA as number to 0\nset counterB as number to 0\nfinalizer increment counterA\nfinalizer increment counterB",
				},
			],
			[VariablesStepper, LogicStepper, Haibun, FinalizerStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);

		expect(result.ok).toBe(true);
		expect((await result.world.shared.all()).counterA?.value).toBe("1");
		expect((await result.world.shared.all()).counterB?.value).toBe("1");
	});

	it("does nothing when no finalizer steps are provided", async () => {
		const result = await passWithDefaults(
			[{ path: "/features/main.feature", content: 'set baseline to "ok"' }],
			[VariablesStepper, Haibun, FinalizerStepper],
			{
				options: { DEST: "default" },
				moduleOptions: {},
			},
		);

		expect(result.ok).toBe(true);
		expect((await result.world.shared.all()).baseline?.value).toBe("ok");
	});

	it("runs finalizers at end of each feature", async () => {
		const result = await passWithDefaults(
			[
				{
					path: "/features/first.feature",
					content: 'set marker to "first"\nfinalizer variable marker is "first"',
				},
				{
					path: "/features/second.feature",
					content: 'set marker to "second"',
				},
			],
			[VariablesStepper, LogicStepper, Haibun, FinalizerStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);

		expect(result.ok).toBe(true);
		expect((await result.world.shared.all()).marker?.value).toBe("second");
	});

	it("cleans registered statements by feature after execution", async () => {
		const result = await passWithDefaults(
			[
				{ path: "/features/first.feature", content: 'set marker to "first"' },
				{ path: "/features/second.feature", content: 'set marker to "second"\nfinalizer variable marker is "second"' },
			],
			[VariablesStepper, LogicStepper, Haibun, FinalizerStepper],
			{ options: { DEST: "default" }, moduleOptions: {} },
		);

		const finalizerStepper = result.steppers.find((stepper) => stepper instanceof FinalizerStepper) as FinalizerStepper | undefined;

		expect(result.ok).toBe(true);
		expect(finalizerStepper).toBeDefined();
		expect(finalizerStepper?.registeredStatementsByFeature.size).toBe(0);
	});
});
