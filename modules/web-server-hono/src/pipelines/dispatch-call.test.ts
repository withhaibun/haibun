import { describe, expect, it } from "vitest";
import { AStepper, READING, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { OK } from "@haibun/core/lib/domains/protocol.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { TEST_STEP } from "@haibun/core/lib/test/test-step.js";
import { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { SessionAuthority } from "@haibun/core/lib/pipelines/session-authority.js";
import { AUTHORITY_KEY } from "@haibun/core/lib/domains/session-authority.js";
import { stubVerifier } from "@haibun/core/lib/test/fake-authority.js";
import { actualityClock } from "@haibun/core/lib/actuality/root.js";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD, actualityFeatureOf, formatRecordName } from "@haibun/core/lib/seq-path.js";
import { LinkRelations, SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import type { TRestsOn } from "@haibun/core/lib/domains/authority-types.js";
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

const CALLER = "did:example:caller";
const REVOKED = "urn:cap:revoked";
/** The chain a caller's proof rests on, whose delegation is `id`. */
const chainOf = (id: string): TRestsOn => ({ capabilities: ["urn:cap:root", id], delegation: { label: "Capability", id } });

/** Calls `relay guarded` as an outside caller that presented `presented`, holds `held` and rests on `restsOn`, through the
 *  dispatch a transport uses, under an authority whose records hold `REVOKED` revoked. Returns the result and a read of a field
 *  of the record of the step at a path under the call's. */
async function relayed(presented: string[], held: string[], restsOn?: TRestsOn) {
	const world = getDefaultWorld();
	world.runtime.backgrounds = [];
	const authority = new SessionAuthority(actualityClock());
	authority.registerVerifier(stubVerifier({ verify: async () => ({ ok: true }), revokedIn: async (ids) => (ids.includes(REVOKED) ? `${REVOKED} was revoked` : undefined) }));
	world.runtime.keys = { ...world.runtime.keys, [AUTHORITY_KEY]: authority };
	const stepper = new RelayStepper();
	const steppers = [stepper];
	await stepper.setWorld(world, steppers);
	const within = { registry: new StepRegistry(steppers, world), world, steppers };
	const caller: TCaller = { capabilityAction: presented, held, principal: CALLER, restsOn, delegate: CALLER };
	const called = calledStep(within, { method: "RelayStepper-relay", params: { what: "guarded" }, asks: undefined, under: undefined }, caller);
	if ("refused" in called) return { result: { refused: called.refused.error } };
	const { seqPath } = called.featureStep;
	const fieldOf = (under: number[], field: string) =>
		world.shared.getStore().get(formatRecordName({ actuality: actualityFeatureOf(world.tag), path: [...seqPath, ...under] }), field, SEQ_PATH_LABEL);
	return { result: await dispatchCall(within, caller, called.featureStep), fieldOf };
}

describe("a call's nested steps", () => {
	it("invoke from what the caller holds, so a statement's node runs under the held action that allows it", async () => {
		expect((await relayed([RELAY], ["*"])).result).toMatchObject({ ok: true });
	});

	it("are refused where the caller holds only the action it presented, and the refusal names the action it lacks and the actions held", async () => {
		const { result } = await relayed([RELAY], [RELAY]);
		expect(result).toMatchObject({ ok: false });
		expect("errorMessage" in result && result.errorMessage).toContain(`RelayStepper-guarded: capability ${GUARDED} required, and the caller holds ${RELAY}`);
	});

	it("aren't reached where the action the call presented doesn't allow the step the call names", async () => {
		expect((await relayed([GUARDED], ["*"])).result).toEqual({ refused: `RelayStepper-relay: capability ${RELAY} required` });
	});

	it("are refused once the chain the call rests on was revoked, as its revocation records state at the nested step", async () => {
		expect((await relayed([RELAY], ["*"], chainOf("urn:cap:held"))).result, "a chain that holds").toMatchObject({ ok: true });
		const { result } = await relayed([RELAY], ["*"], chainOf(REVOKED));
		expect(result).toMatchObject({ ok: false });
		expect("errorMessage" in result && result.errorMessage).toContain(`RelayStepper-guarded: ${REVOKED} was revoked`);
	});

	it("state the held action that allowed them, the principal and the delegation, and not a capabilityAction, which the call's own step states", async () => {
		const { fieldOf } = await relayed([RELAY], ["*"], chainOf("urn:cap:held"));
		if (fieldOf === undefined) throw new Error("the call was refused before it ran");
		expect(await fieldOf([], SEQ_PATH_FIELD.capabilityAction), "the step the call named").toBe(RELAY);
		expect(await fieldOf([], SEQ_PATH_FIELD.allowedAction)).toBe("*");
		expect(await fieldOf([1], SEQ_PATH_FIELD.capabilityAction), "a nested step").toBeUndefined();
		expect(await fieldOf([1], SEQ_PATH_FIELD.allowedAction)).toBe("*");
		expect(await fieldOf([1], LinkRelations.PERFORMED_BY.rel)).toBe(CALLER);
		expect(await fieldOf([1], SEQ_PATH_EDGE.delegation), "an edge to the record of the delegation").toBe("urn:cap:held");
	});
});
