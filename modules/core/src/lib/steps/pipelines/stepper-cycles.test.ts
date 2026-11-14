import { describe, expect, it } from "vitest";
import { AStepper, type IStepperCycles } from "../domains/stepper.js";
import { readWorkSince } from "../../domains/event-loop.js";
import { doStepperCycle } from "./stepper-cycles.js";
import { PhaseRunner } from "./phase-runner.js";
import { declareSteps } from "../domains/stepper.js";

class Starting extends AStepper {
	description = "Reads the work in flight as a cycle method runs.";
	steps = declareSteps({});
	seen: string[][] = [];
	cycles: IStepperCycles = {
		endScenario: () => {
			this.seen.push(readWorkSince());
			return Promise.resolve();
		},
	};
}

describe("the work in flight", () => {
	it("names a phase, and the cycle method of the stepper that runs within it", async () => {
		const starting = new Starting();
		readWorkSince();
		await new PhaseRunner().tryPhase("Collector", () => doStepperCycle([starting], "endScenario", undefined));
		expect(starting.seen).toEqual([["the phase Collector", "Starting.endScenario"]]);
	});

	it("names work in flight at a read again at the next, and doesn't name work that ended before a read after it", async () => {
		await doStepperCycle([new Starting()], "endScenario", undefined);
		expect(readWorkSince(), "in flight at the cycle's own read").toEqual(["Starting.endScenario"]);
		expect(readWorkSince()).toEqual([]);
	});
});
