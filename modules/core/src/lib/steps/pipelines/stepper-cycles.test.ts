import { describe, expect, it } from "vitest";
import { AStepper, type IStepperCycles } from "../domains/stepper.js";
import { doStepperCycle, phaseInProgress } from "./stepper-cycles.js";
import { PhaseRunner } from "./phase-runner.js";

class Starting extends AStepper {
	description = "Notes the phase in progress as a cycle method runs.";
	steps = {};
	seen: string[] = [];
	cycles: IStepperCycles = {
		endScenario: () => {
			this.seen.push(phaseInProgress());
			return Promise.resolve();
		},
	};
}

describe("the phase in progress", () => {
	it("names the start's phase, then the cycle method of the stepper that runs", async () => {
		const starting = new Starting();
		await new PhaseRunner().tryPhase("Collector", () => starting.seen.push(phaseInProgress()));
		await doStepperCycle([starting], "endScenario", undefined);
		expect(starting.seen).toEqual(["the phase Collector", "Starting.endScenario"]);
	});
});
