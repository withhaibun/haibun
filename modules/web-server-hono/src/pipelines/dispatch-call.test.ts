import { describe, expect, it } from "vitest";
import { AStepper, READING, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { calledStep, dispatchCall, type TCaller } from "./dispatch-call.js";

const RELAY = "Relay:run";
const GUARDED = "Relay:guarded";

/** A step that proves the statement it states as a node of its own proof, and the guarded step that statement names. */
class RelayStepper extends AStepper {
	description = "A step whose statement's node requires an action the step itself doesn't require.";
	steps = {
		relay: {
			description: TEST_STEP,
			gwta: "relay {what: statement}",
			capability: RELAY,
			contract: { products: { of: "what" } },
			reading: READING.within,
			context: () => Promise.resolve(<T>(run: () => Promise<T>) => run()),
		},
		guarded: { description: TEST_STEP, gwta: "guarded", capability: GUARDED, action: () => Promise.resolve(OK) },
	} as const satisfies TStepperSteps;
}

/** Calls `relay guarded` as an outside caller that presented `presented` and holds `held`, through the dispatch a transport uses. */
async function relayed(presented: string[], held: string[]) {
	const world = getDefaultWorld();
	world.runtime.backgrounds = [];
	const stepper = new RelayStepper();
	const steppers = [stepper];
	await stepper.setWorld(world, steppers);
	const within = { registry: new StepRegistry(steppers, world), world, steppers };
	const caller: TCaller = { capabilityAction: presented, held, principal: "did:example:caller", restsOn: undefined, delegate: "did:example:caller" };
	const called = calledStep(within, { method: "RelayStepper-relay", params: { what: "guarded" }, asks: undefined, under: undefined }, caller);
	if ("refused" in called) return { refused: called.refused.error };
	return dispatchCall(within, caller, called.featureStep);
}

describe("a call's nested steps", () => {
	it("invoke from what the caller holds, so a statement's node runs under the held action that allows it", async () => {
		expect(await relayed([RELAY], ["*"])).toMatchObject({ ok: true });
	});

	it("are refused where the caller holds only the action it presented, and the refusal names the action it lacks", async () => {
		const refused = await relayed([RELAY], [RELAY]);
		expect(refused).toMatchObject({ ok: false });
		expect("errorMessage" in refused && refused.errorMessage).toContain(`RelayStepper-guarded: capability ${GUARDED} required`);
	});

	it("aren't reached where the action the call presented doesn't allow the step the call names", async () => {
		expect(await relayed([GUARDED], ["*"])).toEqual({ refused: `RelayStepper-relay: capability ${RELAY} required` });
	});
});
