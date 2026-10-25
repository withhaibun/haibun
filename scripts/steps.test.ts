/**
 * The steps of this repository held to the step rules: a step that starts or keeps something takes a parameter, a step has more
 * than one call site, a step's pattern isn't another step's with a word more or less, a feature line, a kireji call, a waypoint
 * or a unit test exercises each step, the count of steps only falls, a step doesn't filter, bound, page, order or count its own
 * list, a list read declares its list, and a step that only states other steps with fixed arguments is a waypoint. A stepper
 * file holds each finding at most as often as steps.baseline.json records.
 */
import { join } from "node:path";
import { describe, it } from "vitest";
import { expectWithinBaseline, REPOSITORY_SCAN_MS } from "@haibun/core/lib/test/baseline.js";
import {
	declaredSteps,
	fixedStatements,
	listOperations,
	nearDuplicates,
	oneCallSite,
	startsWithoutParameters,
	stepCount,
	steppersUnder,
	undeclaredLists,
	unexercised,
} from "@haibun/core/lib/test/step-rules.js";
import { MODULE_SOURCES, REPOSITORY } from "./roots.js";

/** The steps whose pattern selects what they act on with a word a list operation also uses, each with why it isn't a list's. */
const INPUT_SELECTIONS: Record<string, string> = {
	"InstanceStepper.startRun": "matching names the features a run starts, a selection of its input",
	"TestRunnerStepper.runTest": "matching names the features a test run runs, a selection of its input",
	"WebPlaywright.requestsMatching": "matching names the requests a route writes their state for",
};

describe("the steps of this repository", () => {
	it(
		"start what a feature needs through a parameter, have more than one call site, and don't repeat a pattern with a word more or less, and are each exercised, apart from what steps.baseline.json records",
		async () => {
			const steppers = await steppersUnder(REPOSITORY, MODULE_SOURCES);
			const steps = declaredSteps(steppers);
			const found = [
				...startsWithoutParameters(steps),
				...oneCallSite(REPOSITORY, steps),
				...nearDuplicates(steps),
				...unexercised(REPOSITORY, steps),
				...stepCount(steps),
				...listOperations(steps, INPUT_SELECTIONS),
				...undeclaredLists(steppers, steps),
				...fixedStatements(REPOSITORY, steps),
			];
			const fix =
				"start it as a feature starts where an option states it, make it a waypoint of a module's library, give a primitive the difference as a parameter, or exercise it in a feature or a unit test";
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "steps.baseline.json"), found, testFile: "scripts/steps.test.ts", fix });
		},
		REPOSITORY_SCAN_MS,
	);
});
