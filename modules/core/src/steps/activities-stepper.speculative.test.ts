import { describe, it, expect } from "vitest";
import { passWithDefaults } from "../lib/test/lib.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import TestSteps from "../lib/test/TestSteps.js";
import LogicStepper from "./logic-stepper.js";

describe("ActivitiesStepper speculative execution", () => {
	it("should not fail hard when running activity body speculatively", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `
        Activity: Fail
        fails
        waypoint Fail with fails

        not ensure Fail
      `,
		};
		// `not ensure Fail` must catch the failure rather than letting it throw or fail hard.
		const result = await passWithDefaults([feature], [ActivitiesStepper, LogicStepper, TestSteps]);
		expect(result.ok).toBe(true);
	});

	it("should not fail hard when verifying proof speculatively", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `
        Activity: FailProof
        passes
        waypoint FailProof with fails

        not ensure FailProof
      `,
		};
		// Here activity body passes, but proof verification fails.
		// 'ensure FailProof' should fail. 'not' should pass.
		const result = await passWithDefaults([feature], [ActivitiesStepper, LogicStepper, TestSteps]);
		expect(result.ok).toBe(true);
	});
});
