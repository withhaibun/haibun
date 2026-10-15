import { describe, expect, it } from "vitest";
import { requiredAction } from "@haibun/core/lib/actions.js";
import type { TStepperSteps } from "@haibun/core/lib/astepper.js";
import MonitorStepper from "../../monitor-stepper.js";
import { CLIENT_LOG, CLIENT_LOG_ACTION, RECORD_BLIPS, RECORD_BLIPS_ACTION } from "./page-calls.js";

describe("the page's own calls", () => {
	it("state the action each step declares, so a call the page signs before it reads actuality's steps carries what the gate requires", () => {
		const steps: TStepperSteps = new MonitorStepper().steps;
		const declared = ({ stepper, step }: { stepper: string; step: string }): string => {
			const found = steps[step];
			if (found === undefined) throw new Error(`${stepper} doesn't declare ${step}, which the page calls. Declare it, or remove the page's call.`);
			return requiredAction(stepper, step, found);
		};
		expect(declared(CLIENT_LOG)).toBe(CLIENT_LOG_ACTION);
		expect(declared(RECORD_BLIPS)).toBe(RECORD_BLIPS_ACTION);
	});
});
