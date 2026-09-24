/**
 * cli's steppers held to the typed step graph their baseline records: each finding of the chain lint about them is
 * one the file names, and a finding fixed is removed from it.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "@haibun/core/lib/test/step-graph-baseline.js";
import Haibun from "@haibun/core/steps/haibun.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import InstanceStepper from "./instance-stepper.js";
import TestRunnerStepper from "./test-runner-stepper.js";

describe("the typed step graph of cli's steppers", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [InstanceStepper, TestRunnerStepper],
			alongside: [Haibun, VariablesStepper],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});
});
