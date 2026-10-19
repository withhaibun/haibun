/**
 * core's steppers held to the typed step graph their baseline records: each finding of the chain lint about them is
 * one the file names, and a finding fixed is removed from it. The test is logic's, since logic reads the graph and depends on
 * core.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "@haibun/logic/test/step-graph-baseline.js";
import { RemoteStepperProxy } from "@haibun/core/lib/transport/remote-proxy-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import AuthorityStepper from "@haibun/core/steps/authority-stepper.js";
import BlipsStepper from "@haibun/core/steps/blips-stepper.js";
import ConsoleMonitorStepper from "@haibun/core/steps/console-monitor-stepper.js";
import DebuggerStepper from "@haibun/core/steps/debugger-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import Narrator from "@haibun/core/steps/narrator-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import UrakataStepper from "@haibun/core/steps/urakata-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";

describe("the typed step graph of core's steppers", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [ActivitiesStepper, AuthorityStepper, BlipsStepper, ConsoleMonitorStepper, DebuggerStepper, Haibun, Narrator, ResourcesStepper, UrakataStepper, VariablesStepper],
			unloaded: [{ stepper: RemoteStepperProxy, why: "a proxy made for each remote host, whose steps are that host's" }],
			baselineFile: path.join(import.meta.dirname, "core-step-graph.baseline.json"),
			sourceDir: path.join(import.meta.dirname, "../../core/src"),
		});
	});
});
