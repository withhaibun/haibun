import { describe, it, expect } from "vitest";

import { ActivitiesStepper } from "./activities-stepper.js";
import { passWithDefaults } from "../lib/test/lib.js";
import VariablesStepper from "./variables-stepper.js";
import Haibun from "./haibun-stepper.js";

describe("activities-stepper proves the proof first", () => {
	it("should execute activity body when proof fails", async () => {
		const feature = `Feature: Activity body runs when proof fails

    Activity: Knows about data
        set myVariable to "fromActivity"
        waypoint Knows about data with variable myVariable is "fromActivity"

Scenario: Proof fails first time

The variable isn't set, so the proof fails. Ensure runs the activity body.

    ensure Knows about data

The activity body set the variable.

    variable myVariable is "fromActivity"
`;

		const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

		expect(result.ok).toBe(true);
	});

	it("should not execute activity body when proof already passes", async () => {
		const feature = `Feature: Proof already passes

    Activity: Knows about data
        set myVariable to "fromActivity"
        waypoint Knows about data with variable myVariable is "initialValue"

Scenario: The activity body doesn't run when the proof passes

The feature sets the variable to the value the proof checks.

    set myVariable to "initialValue"

The proof passes on the first check, so ensure doesn't run the activity body.
Running the activity body would set myVariable to "fromActivity" and fail the last line.

    ensure Knows about data
    variable myVariable is "initialValue"
`;

		const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

		expect(result.ok).toBe(true);
	});
	it("should prevent recursion when activity body contains waypoint", async () => {
		const feature = `Feature: Ensure doesn't recurse when the activity block contains its waypoint

    Activity: Recursive activity
        set counter to "1"
        waypoint Recursive activity with variable counter is "1"

Scenario: A waypoint in its activity block doesn't recurse

The counter variable isn't set, so the proof fails. Ensure runs the activity body.
The activity body sets counter to 1. The body doesn't include the waypoint line, so ensure doesn't run the body again.
ActivitiesStepper registers the outcome when the waypoint line resolves.

    ensure Recursive activity
    variable counter is "1"
`;

		const result = await passWithDefaults(feature, [ActivitiesStepper, VariablesStepper, Haibun]);

		expect(result.ok).toBe(true);
	});
});
