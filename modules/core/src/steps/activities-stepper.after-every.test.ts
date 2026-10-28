import { describe, it, expect } from "vitest";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { LogicStepper } from "../lib/test/logic-stepper.js";
import TestSteps from "../lib/test/TestSteps.js";
import { itemAt } from "../lib/domains/item-at.js";
import ActivitiesStepper from "./activities-stepper.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun-stepper.js";

describe("ActivitiesStepper with after every hook", () => {
	it("after every hook triggers during waypoint proof verification (substeps)", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `
set counter as number to 0
Activity: Setup test
set verifyCount as number to 0
waypoint Test is ready with set verifyCount as number to 1

after every VariablesStepper, increment counter

ensure Test is ready
variable verifyCount is 1
			`,
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper, LogicStepper]);
		expect(result.ok).toBe(true);
		// counter increments for: set counter, set verifyCount (activity), set verifyCount (proof)
		// But NOT for the increment itself (same actionName filter)
	});

	it("after every hook triggers while an ensure outcome's substeps run", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `Activity: Setup
set counter as number to 0
waypoint Is ready with variable counter exists

set hookCount as number to 0
after every VariablesStepper, increment hookCount

ensure Is ready`,
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper, LogicStepper]);
		expect(result.ok).toBe(true);
		// hookCount now increments for substeps too (new behavior)
	});

	it("after every hook should trigger for top-level steps AND substeps, but not its own actions", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `Activity: Setup
set counter as number to "0"
waypoint Ready with set counter as number to "1"

set hookCount as number to "0"
after every VariablesStepper, set hookCount as number to "1"

set someValue to "test"
ensure Ready`,
		};

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesStepper, LogicStepper]);

		// hookCount should be "1": triggered from various VariablesStepper steps
		// The set hookCount as number to "1" won't infinitely recurse because of same-actionName filter
		expect(result.ok).toBe(true);
	});
});

describe("a rule over step records", () => {
	it("proves its statement after each step of its stepper", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", Noodles, man.\npasses\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, ActivitiesStepper, LogicStepper]);
		expect(result.ok).toBe(true);
		const ins = itemAt(result.featureResults, 0).stepResults.map((r) => r.in);
		expect(ins).toEqual(["have a test", 'after every "TestSteps", Noodles, man.', "passes", "Noodles, man.", "passes", "Noodles, man."]);
	});

	it("fails a step whose after-every step fails, states why, and records the step before its after-every step", async () => {
		const feature = { path: "/features/test.feature", content: 'after every "TestSteps", fails\npasses' };
		const result = await failWithDefaults([feature], [Haibun, TestSteps, ActivitiesStepper, LogicStepper]);
		const results = itemAt(result.featureResults, 0).stepResults;
		const passes = results.find((r) => r.in === "passes");
		expect(passes?.ok, "a cycle fails a step that passed").toBe(false);
		expect(passes?.errorMessage).toMatch(/a step run after every TestSteps step failed: /);
		expect(results.map((r) => r.in).slice(-2), "the step is recorded before the step its cycle ran").toEqual(["passes", "fails"]);
	});

	it("proves its statement under the step it follows", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", passes\nhave a test\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, ActivitiesStepper, LogicStepper]);
		expect(result.ok).toBe(true);
		const seqs = itemAt(result.featureResults, 0).stepResults.map((r) => r.seqPath);
		// Step [0,1,0,4] "passes" doesn't run the after-every step, since the after-every step is the same action.
		expect(seqs).toEqual([
			[0, 1, 0, 1],
			[0, 1, 0, 2],
			[0, 1, 0, 3],
			[0, 1, 0, 3, 1],
			[0, 1, 0, 4],
		]);
	});

	it("runs once after a step of the feature and doesn't run after its substeps", async () => {
		const feature = { path: "/features/test.feature", content: ["have a test", 'after every "TestSteps", Noodles, man.', "passes", "didn't fails"].join("\n") };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, ActivitiesStepper, LogicStepper]);
		expect(result.ok).toBe(true);
		const said = itemAt(result.featureResults, 0).stepResults.filter((r) => r.in === "Noodles, man.").length;
		expect(said, "the statement runs for the step the feature holds and doesn't run for the substep that another step ran").toBe(1);
	});
});
