/**
 * The logic module's stepper held to the typed step graph its baseline records: each finding of the chain lint about it is
 * one the file names, and a finding fixed is removed from it.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "./test/step-graph-baseline.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import LogicStepper from "./logic-stepper.js";

describe("the typed step graph of the logic module's stepper", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [LogicStepper],
			alongside: [Haibun],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});
});
