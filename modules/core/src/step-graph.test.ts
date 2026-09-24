/**
 * core's steppers held to the typed step graph their baseline records: each finding of the chain lint about them is
 * one the file names, and a finding fixed is removed from it.
 */
import { describe, it } from "vitest";
import path from "node:path";
import { expectStepGraphAsRecorded } from "./lib/test/step-graph-baseline.js";
import { RemoteStepperProxy } from "./lib/remote-stepper-proxy.js";
import ActivitiesStepper from "./steps/activities-stepper.js";
import AuthorityStepper from "./steps/authority-stepper.js";
import BlipsStepper from "./steps/blips-stepper.js";
import ConsoleMonitorStepper from "./steps/console-monitor-stepper.js";
import DebuggerStepper from "./steps/debugger-stepper.js";
import FinalizerStepper from "./steps/finalizer-stepper.js";
import GoalResolutionStepper from "./steps/goal-resolution-stepper.js";
import Haibun from "./steps/haibun.js";
import LogicStepper from "./steps/logic-stepper.js";
import Narrator from "./steps/narrator.js";
import ResourcesStepper from "./steps/resources-stepper.js";
import UrakataStepper from "./steps/urakata-stepper.js";
import VariablesStepper from "./steps/variables-stepper.js";

describe("the typed step graph of core's steppers", () => {
	it("has only the findings its baseline records", { timeout: 60_000 }, async () => {
		await expectStepGraphAsRecorded({
			owned: [
				ActivitiesStepper,
				AuthorityStepper,
				BlipsStepper,
				ConsoleMonitorStepper,
				DebuggerStepper,
				FinalizerStepper,
				GoalResolutionStepper,
				Haibun,
				LogicStepper,
				Narrator,
				ResourcesStepper,
				UrakataStepper,
				VariablesStepper,
			],
			unloaded: [{ stepper: RemoteStepperProxy, why: "a proxy made for each remote host, whose steps are that host's" }],
			baselineFile: path.join(import.meta.dirname, "step-graph.baseline.json"),
			sourceDir: import.meta.dirname,
		});
	});
});
