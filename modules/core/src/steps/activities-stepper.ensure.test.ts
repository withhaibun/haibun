import { describe, it, expect } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun-stepper.js";

describe("ActivitiesStepper runs the steps after an ensure", () => {
	const steppers = [Haibun, VariablesStepper, ActivitiesStepper];

	it("should run steps following an immediately satisfied ensure", async () => {
		// Defines "Precondition" activity that satisfies "Precondition met"
		const bg = [
			"Activity: Satisfy Precondition",
			'set pre to "done"',
			'waypoint Precondition met with variable pre is "done"',
			"",
			"Activity: Main Flow",
			"ensure Precondition met",
			'set ran_steps to "yes"',
			'waypoint Main Flow Done with variable ran_steps is "yes"',
		].join("\n");

		// Scenario that triggers Main Flow
		const scenario = ['set pre to "done"', "ensure Main Flow Done"].join("\n");
		// Note: pre exists to "done" initially, so "ensure Precondition met" should pass immediately and NOT run "Satisfy Precondition".
		// Then it should proceed to 'set ran_steps to "yes"'.

		const feature = { path: "/features/test.feature", content: scenario };

		const result = await passWithDefaults([feature], steppers, undefined, [{ path: "/backgrounds/bg.feature", content: bg }]);

		expect(result.ok).toBe(true);
		// "ensure Main Flow Done" passing implies the waypoint proof "variable ran_steps is 'yes'"
		// held, so the body's `set ran_steps` step was not skipped.
	});

	it.each(["The table is laid", "A table is laid"])("ensures a waypoint whose name starts with a leading word dePolite removes: %s", async (name) => {
		const content = ["Activity: Lay the table", 'set laid to "yes"', `waypoint ${name} with variable laid is "yes"`, `ensure ${name}`].join("\n");
		const result = await passWithDefaults([{ path: "/features/test.feature", content }], steppers);
		expect(result.ok, result.failure?.error?.message).toBe(true);
	});

	it("should run steps following a satisfied ensure (when remediation ran)", async () => {
		const bg = [
			"Activity: Satisfy Precondition",
			'set pre to "done"',
			'waypoint Precondition met with variable pre is "done"',
			"",
			"Activity: Main Flow",
			"ensure Precondition met",
			'set ran_steps to "yes"',
			'waypoint Main Flow Done with variable ran_steps is "yes"',
		].join("\n");

		// Here 'pre' is NOT set initially.
		// 'ensure Precondition met' should trigger 'Satisfy Precondition'.
		// Then return to 'Main Flow' and run 'set ran_steps to "yes"'.
		const scenario = "ensure Main Flow Done";

		const feature = { path: "/features/test.feature", content: scenario };

		const result = await passWithDefaults([feature], steppers, undefined, [{ path: "/backgrounds/bg.feature", content: bg }]);
		expect(result.ok).toBe(true);
	});
});
