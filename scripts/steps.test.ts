/**
 * The steps of this repository held to three rules: a step that starts or keeps something takes a parameter, a step has more
 * than one call site, and a step's pattern isn't another step's with a word more or less. A stepper file holds each finding
 * at most as often as steps.baseline.json records.
 */
import { join } from "node:path";
import { describe, it } from "vitest";
import { expectWithinBaseline, REPOSITORY_SCAN_MS } from "@haibun/core/lib/test/baseline.js";
import { declaredSteps, nearDuplicates, oneCallSite, startsWithoutParameters, steppersUnder } from "@haibun/core/lib/test/step-rules.js";
import { MODULE_SOURCES, REPOSITORY } from "./roots.js";

describe("the steps of this repository", () => {
	it(
		"start what a feature needs through a parameter, have more than one call site, and don't repeat a pattern with a word more or less, apart from what steps.baseline.json records",
		async () => {
			const steps = declaredSteps(await steppersUnder(REPOSITORY, MODULE_SOURCES));
			const found = [...startsWithoutParameters(steps), ...oneCallSite(REPOSITORY, steps), ...nearDuplicates(steps)];
			const fix = "start it as a feature starts where an option states it, make it a waypoint of a module's library, or give a primitive the difference as a parameter";
			expectWithinBaseline({ baselineFile: join(import.meta.dirname, "steps.baseline.json"), found, testFile: "scripts/steps.test.ts", fix });
		},
		REPOSITORY_SCAN_MS,
	);
});
