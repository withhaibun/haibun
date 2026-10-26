import { describe, it, expect } from "vitest";
import { failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { LogicStepper } from "../lib/test/logic-stepper.js";
import Haibun from "./haibun-stepper.js";
import VariablesSteppers from "./variables-stepper.js";
import ActivitiesStepper from "./activities-stepper.js";
import { DEF_PROTO_OPTIONS } from "../lib/test/lib.js";

describe("Activities ensure flow", () => {
	it("should execute activity body then verify proof when proof initially fails", async () => {
		const background = {
			path: "/backgrounds/test.feature",
			content: `
Activity: Set up Wikipedia
set enWikipedia to "https://en.wikipedia.org/wiki/"
set haibunUrl to "https://en.wikipedia.org/wiki/Haibun"
waypoint Knows about Wikipedia with variable "enWikipedia" exists
`,
		};

		const feature = {
			path: "/features/test.feature",
			content: `Feature: Test ensure flow

This test checks the order of the ensure step.
1. A feature line calls ensure X.
2. Ensure runs the proof. The step passes where the proof passes.
3. Ensure runs the activity body where the proof fails. The body doesn't include the waypoint line.
4. Ensure runs the proof again.
5. The step passes where the second proof passes. It fails otherwise.

The expected order follows.
- ensure Knows about Wikipedia.
- The proof "variable enWikipedia exists" fails, since enWikipedia isn't set.
- Ensure runs the activity body.
  - set enWikipedia to https://en.wikipedia.org/wiki/.
  - set haibunUrl to https://en.wikipedia.org/wiki/Haibun.
  - The activity body excludes the waypoint line, so ensure doesn't recurse.
- The proof "variable enWikipedia exists" passes, since the body set enWikipedia.
- The step passes.

Scenario: Ensure executes activity body when proof fails
ensure Knows about Wikipedia
variable enWikipedia is "https://en.wikipedia.org/wiki/"
variable haibunUrl is "https://en.wikipedia.org/wiki/Haibun"
`,
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers, LogicStepper], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(true);
	});

	it("should skip activity body when proof already passes", async () => {
		const background = {
			path: "/backgrounds/test.feature",
			content: `
Activity: Set up Wikipedia
set enWikipedia to "https://en.wikipedia.org/wiki/"
set counter to "0"
waypoint Knows about Wikipedia with variable enWikipedia exists
`,
		};

		const feature = {
			path: "/features/test.feature",
			content: `
Feature: Test ensure flow
Scenario: Ensure skips activity when proof passes
set enWikipedia to "https://already-set.com/"
ensure Knows about Wikipedia
`,
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers, LogicStepper], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(true);
	});

	it("should fail if proof fails after the activity's body runs", async () => {
		const background = {
			path: "/backgrounds/test.feature",
			content: `
Activity: Broken setup
set wrongVariable to "something"
waypoint Needs correct variable with variable correctVariable exists
`,
		};

		const feature = {
			path: "/features/test.feature",
			content: `
Feature: Test ensure flow
Scenario: Ensure fails when proof still fails after activity
ensure Needs correct variable
`,
		};

		const result = await failWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers, LogicStepper], DEF_PROTO_OPTIONS, [background]);

		expect(result.ok).toBe(false);
	});

	it("should not recurse when the activity body doesn't include the waypoint line", async () => {
		// activityBlockSteps excludes the waypoint line, so ensure doesn't recurse.
		const background = {
			path: "/backgrounds/test.feature",
			content: `
Activity: Knows about Wikipedia
set enWikipedia to "https://en.wikipedia.org/wiki/"
set haibunUrl to "https://en.wikipedia.org/wiki/Haibun"
waypoint Knows about Wikipedia with variable enWikipedia exists
`,
		};

		const feature = {
			path: "/features/test.feature",
			content: `
Feature: Test that ensure doesn't recurse
Scenario: Ensure does not recurse infinitely
ensure Knows about Wikipedia
`,
		};

		const result = await passWithDefaults([feature], [ActivitiesStepper, Haibun, VariablesSteppers, LogicStepper], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		expect(result.world.runtime.exhaustionError).toBeUndefined();
	});
});
