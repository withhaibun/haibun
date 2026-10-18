/**
 * Tests the intent that FlowRunner gives nested steps. A speculative step's failure is expected. Actuality doesn't count
 * it as its own failure. A step that a speculative step runs without passing an intent inherits the speculative intent at
 * any depth. A step that doesn't inherit or receive a speculative intent runs with the authoritative intent.
 */
import { describe, it, expect } from "vitest";
import { AStepper, type TFeatureStep } from "../domains/stepper.js";
import { OK, type TStepArgs } from "../../domains/protocol.js";
import { passWithDefaults, DEF_PROTO_OPTIONS } from "../../test/lib.js";
import { actionNotOK } from "../../util/index.js";
import { FlowRunner } from "./flow-runner.js";

class SpeculationStepper extends AStepper {
	description = "Defines a step that refuses, a step that runs it without passing an intent, and a step that runs the second step speculatively.";
	steps = {
		/** Returns a refusal on every call. */
		refuses: { exact: "refuses", action: async () => Promise.resolve(actionNotOK("refused")) },
		/** Runs `refuses` without passing an intent, as a stepper that runs the statements it receives does. It discards the nested result and returns OK. */
		runs: {
			exact: "runs the refusal",
			action: async (_args: TStepArgs, featureStep: TFeatureStep) => {
				const runner = new FlowRunner(this.getWorld(), [this as unknown as AStepper]);
				await runner.runStatements(["refuses"], { parentStep: featureStep });
				return OK;
			},
		},
		/** Runs `runs the refusal` with a speculative intent, as a proof or a poll does. It discards the nested result and returns OK. */
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
	expect(result.ok, "actuality passed").toBe(true);
	return result.featureResults?.[0]?.stepResults ?? [];
};

describe("a speculative step", () => {
	it("passes its intent to a failing step that it runs without an intent", async () => {
		const steps = await ranSteps("tries the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal failed").toBe(false);
		expect(refusal?.intent?.mode, "the refusal inherits the intent of `runs the refusal`").toBe("speculative");
	});

	it("takes its intent from the step that runs it", async () => {
		const steps = await ranSteps("tries the refusal");
		const ran = steps.find((s) => s.in === "runs the refusal");
		expect(ran?.intent?.mode, "`runs the refusal` has the intent that `tries the refusal` passes").toBe("speculative");
	});
});

describe("a step that isn't run speculatively", () => {
	it("is authoritative", async () => {
		const steps = await ranSteps("runs the refusal");
		const refusal = steps.find((s) => s.in === "refuses");
		expect(refusal?.ok, "the refusal failed").toBe(false);
		expect(refusal?.intent?.mode, "the refusal is authoritative").toBe("authoritative");
	});
});
