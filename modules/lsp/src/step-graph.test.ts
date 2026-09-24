/**
 * lsp's steppers held to the typed step graph their baseline records: each finding of the chain lint about them is
 * one the file names, and a finding fixed is removed from it.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "@haibun/core/lib/test/step-graph-baseline.js";
import Haibun from "@haibun/core/steps/haibun.js";
import LspStepper from "./lsp-stepper.js";
import MonitorJsonRpc from "./monitor-json-rpc.js";

describe("the typed step graph of lsp's steppers", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [LspStepper, MonitorJsonRpc],
			alongside: [Haibun],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});
});
