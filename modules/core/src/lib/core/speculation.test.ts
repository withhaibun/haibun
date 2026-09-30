/**
 * What a run claims and what it is merely trying. A step run speculatively is asked in case it applies: its failure
 * is the run finding out, not the run failing. That has to hold for whatever the speculative step runs in turn, or a
 * study of a failing thing fails actuality studying it.
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
		/** Runs the refusal without stating anything about intent, as a stepper that just runs what it was given does. */
		runs: {
			exact: "runs the refusal",
			action: async (_args: TStepArgs, featureStep: TFeatureStep) => {
				const runner = new FlowRunner(this.getWorld(), [this as unknown as AStepper]);
				await runner.runStatements(["refuses"], { parentStep: featureStep });
				return OK;
			},
		},
		/** Tries that, in case it applies, as a proof or a poll does: what it finds is this step's answer, not actuality's. */
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
	expect(result.ok, "actuality itself passed").toBe(true);
	return result.featureResults?.[0]?.stepResults ?? [];
};

describe("a step actuality is trying, not claiming", () => {
	it("does not fail actuality, however deep the trying goes", async () => {
		const steps = await ranSteps("tries the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal happened").toBe(false);
		expect(refusal?.intent?.mode, "and everything under the trying is marked as tried, not claimed").toBe("speculative");
	});

	it("is what the trying produces, not what each step under it remembered to produce", async () => {
		const steps = await ranSteps("tries the refusal");
		const ran = steps.find((s) => s.in === "runs the refusal");
		expect(ran?.intent?.mode, "a step that doesn't state an intent takes its parent's").toBe("speculative");
	});
});

describe("a step actuality is claiming", () => {
	it("is marked as claimed when the steps above it weren't trying it, so a parent that propagates its failure fails actuality", async () => {
		const steps = await ranSteps("runs the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal happened here too").toBe(false);
		expect(refusal?.intent?.mode, "and is actuality's own claim, since a step wasn't trying it out").toBe("authoritative");
	});
});
