/**
 * Waypoints' proofs on the reasoner: a head nested in a proof is a goal of the same session, a stated falsity refutes a head, a
 * head applied again below itself is unknown within a session and across the sessions a step's statements nest, and a proof
 * that nests sessions without repeating a head is refused past the bound of nesting.
 */
import { describe, expect, it } from "vitest";
import { passWithDefaults } from "@haibun/core/lib/test/lib.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import { MAX_NESTED_SESSIONS } from "./waypoints.js";

const STEPPERS = [Haibun, VariablesStepper, ActivitiesStepper, LogicStepper];
const passes = async (...lines: string[]) => {
	const result = await passWithDefaults(lines.join("\n"), STEPPERS);
	expect(result.ok, result.failure?.error?.message).toBe(true);
};

describe("waypoints' proofs on the reasoner", () => {
	it("proves a head nested in a proof as a goal of the same session", { timeout: 60_000 }, async () => {
		await passes(
			"Activity: Lay the table",
			'set table to "laid"',
			'waypoint The table is laid with variable table is "laid"',
			"Activity: Serve dinner",
			'set served to "yes"',
			"waypoint Dinner is served with The table is laid",
			'set table to "laid"',
			"set dinner from maybe Dinner is served",
			'variable dinner.verdict is "proved"',
		);
	});

	it("refutes a head whose falsity is stated, and holds a contradiction where its proof holds as well", { timeout: 60_000 }, async () => {
		await passes(
			"Activity: Open the door",
			'waypoint The door is open with variable door is "open"',
			"absent The door is open",
			"set shut from maybe ensure The door is open",
			'variable shut.verdict is "refuted"',
			'set door to "open"',
			"set both from maybe ensure The door is open",
			'variable both.verdict is "contradiction"',
		);
	});

	it("leaves a head unknown where its proof applies it again below itself in the same session", { timeout: 60_000 }, async () => {
		await passes("Activity: Recurse", "waypoint Recursion with Recursion", "set recursed from maybe Recursion", 'variable recursed.verdict is "unknown"');
	});

	it("leaves a head unknown where a step's statements in its proof apply it again, across the sessions they nest", { timeout: 60_000 }, async () => {
		await passes("Activity: Loop", "waypoint Loops with didn't didn't Loops", "set looped from maybe Loops", 'variable looped.verdict is "unknown"');
	});

	it("refuses a proof that nests sessions past the bound of nesting without repeating a head", { timeout: 120_000 }, async () => {
		await passes(
			"set counter as number to 0",
			"Activity: Count",
			"waypoint Count {n: number} with where increment counter, didn't didn't Count `counter`",
			"set counted from maybe Count 0",
			'variable counted.verdict is "unknown"',
			`variable counter is ${MAX_NESTED_SESSIONS}`,
			'matches counted.refusal with "*the bound of nesting*"',
		);
	});
});
