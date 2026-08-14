/**
 * What a run claims and what it is merely trying. A step run speculatively is asked in case it applies: its failure
 * is the run finding out, not the run failing. That has to hold for whatever the speculative step runs in turn, or a
 * study of a failing thing fails the run studying it.
 */
import { describe, it, expect } from "vitest";
import { AStepper, type TFeatureStep } from "../astepper.js";
import { OK, type TStepArgs } from "../../schema/protocol.js";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "../test/lib.js";
import { actionNotOK } from "../util/index.js";
import { FlowRunner } from "./flow-runner.js";

class SpeculationStepper extends AStepper {
	steps = {
		/** A step that always refuses: what a speculative run is trying out. */
		refuses: {
			exact: "refuses",
			action: async () => Promise.resolve(actionNotOK("refused")),
		},
		/** Runs the refusal without saying anything about intent, as a stepper that just runs what it was given does. */
		runs: {
			exact: "runs the refusal",
			action: async (_args: TStepArgs, featureStep: TFeatureStep) => {
				const runner = new FlowRunner(this.getWorld(), [this as unknown as AStepper]);
				await runner.runStatements(["refuses"], { parentStep: featureStep });
				return OK;
			},
		},
		/** Tries that, in case it applies, as a proof or a poll does: what it finds is this step's answer, not the run's. */
		tries: {
			exact: "tries the refusal",
			action: async (_args: TStepArgs, featureStep: TFeatureStep) => {
				const runner = new FlowRunner(this.getWorld(), [this as unknown as AStepper]);
				await runner.runStatements(["runs the refusal"], { intent: { mode: "speculative" }, parentStep: featureStep });
				return OK;
			},
		},
	};
}

const ranSteps = async (content: string) => {
	const result = await passWithDefaults([{ path: "/features/test.feature", content }], [SpeculationStepper], DEF_PROTO_OPTIONS, []);
	expect(result.ok, "the run itself passed").toBe(true);
	return result.featureResults?.[0]?.stepResults ?? [];
};

describe("a step the run is trying, not claiming", () => {
	it("does not fail the run, however deep the trying goes", async () => {
		const steps = await ranSteps("tries the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal happened").toBe(false);
		expect(refusal?.intent?.mode, "and everything under the trying is marked as tried, not claimed").toBe("speculative");
	});

	it("is what the trying says, not what each step under it remembered to say", async () => {
		const steps = await ranSteps("tries the refusal");
		const ran = steps.find((s) => s.in === "runs the refusal");
		expect(ran?.intent?.mode, "a step that says nothing about intent takes its parent's").toBe("speculative");
	});
});

describe("a step the run is claiming", () => {
	it("is marked as claimed when nothing above it was trying anything, so a parent that propagates its failure fails the run", async () => {
		const steps = await ranSteps("runs the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal happened here too").toBe(false);
		expect(refusal?.intent?.mode, "and is the run's own claim, since nothing was trying it out").toBe("authoritative");
	});
});
