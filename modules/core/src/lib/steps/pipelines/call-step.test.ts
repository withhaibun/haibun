import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AStepper, declareSteps, type IHasCycles, type IStepperCycles } from "../domains/stepper.js";
import { actionOK } from "../../domains/util.js";
import { passWithDefaults } from "../../test/lib.js";
import { TEST_STEP } from "../../test/test-step.js";
import { Access } from "../../domains/resources.js";
import { inCall } from "../../domains/capability-context.js";
import { writeAction } from "../../domains/actions.js";
import { recordChange } from "../domains/contract.js";
import { stepMethodName } from "../domains/step-method.js";
import { callStepAsRoute } from "./call-step.js";

/** A record type the routed step changes, stored public. */
const NOTICE = "Notice";
let held: string | readonly string[] | undefined;

class RoutedStepper extends AStepper implements IHasCycles {
	description = "A route's step that changes a public record, and a step that calls it as a route does.";
	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{
					selectors: ["notice"],
					schema: z.object({ id: z.string() }),
					topology: { persistedAs: NOTICE, id: "id", properties: {}, accessLevel: Access.public },
					description: "A notice a route posts",
				},
			],
		}),
	};
	steps = declareSteps({
		postNotice: {
			description: TEST_STEP,
			gwta: "post the notice",
			readsAt: Access.private,
			contract: { changes: [recordChange(NOTICE)] },
			action: () => {
				held = inCall()?.held;
				return actionOK();
			},
		},
		routeTheNotice: {
			description: TEST_STEP,
			gwta: "route the notice",
			action: async () => {
				const { result } = await callStepAsRoute(this.getWorld(), stepMethodName(this, "postNotice"), {}, undefined);
				return result;
			},
		},
	});
}

describe("callStepAsRoute", () => {
	it("holds the write action of each level the step's contract changes, derived from the types it names", async () => {
		const res = await passWithDefaults("route the notice", [RoutedStepper]);
		expect(res.ok).toBe(true);
		expect(held, "the public notice the contract changes").toContain(writeAction(Access.public));
	});
});
