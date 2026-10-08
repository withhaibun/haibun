import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "./astepper.js";
import { actionOKWithProducts, actionNotOK } from "./util/index.js";
import { StepRegistry } from "./step-registry.js";
import { registerDomains } from "./domains.js";
import { getDefaultWorld } from "./test/lib.js";
import type { TWorld } from "./world.js";
import { FACT_GRAPH } from "./working-memory.js";
import type { TMichi } from "./goal-resolver.js";
import { CHAIN_INSTANCE_STATUS, createChainInstance } from "./chain-instance.js";
import { advanceChainInstance } from "./chain-walker.js";
import { RUN_AUTHORITY, runActingAs } from "./capability-context.js";
import { itemAt } from "./util/item-at.js";

const ISSUER_DOMAIN = "issuer";
const VC_DOMAIN = "vc";

const IssuerSchema = z.object({ issuerId: z.string() });
const VcSchema = z.object({ vcId: z.string() });

class IssueStepper extends AStepper {
	description = "Issues a credential's issuer.";
	steps: TStepperSteps = {
		issueCredential: {
			gwta: "issue credential",
			productsDomain: ISSUER_DOMAIN,
			action: ({ issuerId }: { issuerId: string }) => Promise.resolve(actionOKWithProducts({ issuerId: issuerId ?? "default-issuer" })),
		},
	};
}

class VcStepper extends AStepper {
	description = "Issues a credential.";
	steps: TStepperSteps = { issueVc: { gwta: "issue a credential", productsDomain: VC_DOMAIN, action: () => Promise.resolve(actionOKWithProducts({ vcId: "vc-001" })) } };
}

class CountingStepper extends AStepper {
	description = "Counts to a number and produces an issuer.";
	steps: TStepperSteps = {
		countTo: {
			gwta: "count to {count: number}",
			productsDomain: ISSUER_DOMAIN,
			action: ({ count }: { count: number }) => Promise.resolve(actionOKWithProducts({ issuerId: `counted-${count}` })),
		},
	};
}

class BrokenStepper extends AStepper {
	description = "A step that fails.";
	steps: TStepperSteps = { fail: { gwta: "fail", action: () => Promise.resolve(actionNotOK("intentional failure")) } };
}

/** Builds the context of a walk that actuality advances. `RUN_AUTHORITY` allows every action. `createChainInstance` reads
 *  the walk's owner from the acting principal, not from this context. */
function buildContext(world: TWorld, steppers: AStepper[]): { registry: StepRegistry; world: TWorld; steppers: AStepper[]; grantedCapability: string[] } {
	registerDomains(world, [
		[
			{ selectors: [ISSUER_DOMAIN], schema: IssuerSchema, description: "issuer identity" },
			{ selectors: [VC_DOMAIN], schema: VcSchema, description: "verifiable credential" },
		],
	]);
	const registry = new StepRegistry(steppers, world);
	return { registry, world, steppers, grantedCapability: RUN_AUTHORITY };
}

const twoStepMichi: TMichi = {
	steps: [
		{ stepperName: "IssueStepper", stepName: "issueCredential", gwta: "issue credential", productsDomain: ISSUER_DOMAIN },
		{ stepperName: "VcStepper", stepName: "issueVc", gwta: "issue a credential", productsDomain: VC_DOMAIN },
	],
	bindings: [{ kind: "argument", domain: ISSUER_DOMAIN }],
};

describe("chain-walker", () => {
	let world: TWorld;
	beforeEach(() => {
		world = getDefaultWorld();
	});

	it("advances one step at a time, recording the produced fact id per step", async () => {
		const ctx = buildContext(world, [new IssueStepper(), new VcStepper()]);
		const inst = await createChainInstance(world, VC_DOMAIN, twoStepMichi);

		const first = await advanceChainInstance(ctx, inst.id, { issuerId: "alice" });
		expect(first.kind).toBe("advanced");
		if (first.kind !== "advanced") throw new Error("unreachable");
		expect(first.instance.stepIndex).toBe(1);
		expect(first.instance.status).toBe(CHAIN_INSTANCE_STATUS.PENDING);
		expect(first.factIds).toHaveLength(1);
		const issuerFact = await world.shared.getStore().get(itemAt(first.factIds, 0), ISSUER_DOMAIN, FACT_GRAPH);
		expect(issuerFact).toMatchObject({ issuerId: "alice" });

		const second = await advanceChainInstance(ctx, inst.id, {});
		expect(second.kind).toBe("completed");
		if (second.kind !== "completed") throw new Error("unreachable");
		expect(second.instance.stepIndex).toBe(2);
		expect(second.instance.status).toBe(CHAIN_INSTANCE_STATUS.COMPLETED);
		expect(second.instance.stepFactIds[1]).toHaveLength(1);
	});

	it("sets status to failed when a step's action returns not-ok, and stops the walk", async () => {
		const ctx = buildContext(world, [new BrokenStepper()]);
		const inst = await createChainInstance(world, "any-goal", { steps: [{ stepperName: "BrokenStepper", stepName: "fail", productsDomain: "any-goal" }], bindings: [] });
		const result = await advanceChainInstance(ctx, inst.id, {});
		expect(result.kind).toBe("failed");
		if (result.kind !== "failed") throw new Error("unreachable");
		expect(result.instance.status).toBe(CHAIN_INSTANCE_STATUS.FAILED);
		expect(result.error).toMatch(/intentional failure/);
	});

	it("returns failed when the named step isn't in the registry (the chain references a stepper that isn't loaded)", async () => {
		const ctx = buildContext(world, [new IssueStepper()]);
		const inst = await createChainInstance(world, "any-goal", { steps: [{ stepperName: "NotRegistered", stepName: "nope", productsDomain: "any-goal" }], bindings: [] });
		const result = await advanceChainInstance(ctx, inst.id, {});
		expect(result.kind).toBe("failed");
		if (result.kind !== "failed") throw new Error("unreachable");
		expect(result.error).toMatch(/"NotRegistered-nope" isn't a step actuality registers/);
	});

	it("returns completed again after every step has produced a fact", async () => {
		const ctx = buildContext(world, [new VcStepper()]);
		const inst = await createChainInstance(world, VC_DOMAIN, { steps: [{ stepperName: "VcStepper", stepName: "issueVc", productsDomain: VC_DOMAIN }], bindings: [] });
		await advanceChainInstance(ctx, inst.id, {});
		const again = await advanceChainInstance(ctx, inst.id, {});
		expect(again.kind).toBe("completed");
		if (again.kind !== "completed") throw new Error("unreachable");
		expect(again.instance.status).toBe(CHAIN_INSTANCE_STATUS.COMPLETED);
	});
});

describe("a walk owned by whoever began it", () => {
	// Each step of a walk runs with the arguments of the reader who began the walk, so a walk's id doesn't authorize another
	// reader to advance it. The walker compares the walk's owner with the acting principal. It doesn't read an owner from
	// the arguments.
	let world: TWorld;
	beforeEach(() => {
		world = getDefaultWorld();
	});

	it("is advanced by the reader who began it", async () => {
		const ctx = buildContext(world, [new IssueStepper(), new VcStepper()]);
		const inst = await runActingAs("did:example:alice", () => createChainInstance(world, VC_DOMAIN, twoStepMichi));
		expect(inst.owner, "the walk records who began it").toBe("did:example:alice");
		const advanced = await runActingAs("did:example:alice", () => advanceChainInstance(ctx, inst.id, { issuerId: "alice" }));
		expect(advanced.kind).toBe("advanced");
	});

	it("is refused to anyone else, and to a call without a principal", async () => {
		const ctx = buildContext(world, [new IssueStepper(), new VcStepper()]);
		const inst = await runActingAs("did:example:alice", () => createChainInstance(world, VC_DOMAIN, twoStepMichi));
		await expect(runActingAs("did:example:mallory", () => advanceChainInstance(ctx, inst.id, { issuerId: "mallory" }))).rejects.toThrow(/begun by did:example:alice/);
		await expect(advanceChainInstance(ctx, inst.id, { issuerId: "nobody" }), "and to a call without a principal").rejects.toThrow(/begun by did:example:alice/);
	});

	it("a walk an unnamed caller began isn't advanced by a named one", async () => {
		const ctx = buildContext(world, [new IssueStepper(), new VcStepper()]);
		const inst = await createChainInstance(world, VC_DOMAIN, twoStepMichi);
		expect(inst.owner).toBeUndefined();
		await expect(runActingAs("did:example:mallory", () => advanceChainInstance(ctx, inst.id, {}))).rejects.toThrow(/begun by an unnamed caller/);
	});
});

describe("a walk gives a step only what that step takes", () => {
	// Every other caller of a step passes the same validation. A walk that dispatched unvalidated arguments would bypass
	// that validation.
	let world: TWorld;
	beforeEach(() => {
		world = getDefaultWorld();
	});

	const countingMichi: TMichi = {
		steps: [{ stepperName: "CountingStepper", stepName: "countTo", gwta: "count to {count: number}", productsDomain: ISSUER_DOMAIN }],
		bindings: [{ kind: "argument", domain: ISSUER_DOMAIN }],
	};

	it("fails the walk when an argument doesn't match the step's declaration, and doesn't dispatch the step", async () => {
		const ctx = buildContext(world, [new CountingStepper()]);
		const inst = await createChainInstance(world, ISSUER_DOMAIN, countingMichi);
		const advanced = await advanceChainInstance(ctx, inst.id, { count: "not a number" });
		expect(advanced.kind).toBe("failed");
		if (advanced.kind !== "failed") throw new Error("unreachable");
		expect(advanced.error).toMatch(/CountingStepper-countTo validation failed .*invalid number/);
		expect(advanced.instance.status).toBe(CHAIN_INSTANCE_STATUS.FAILED);
	});

	it("runs the step with the value coerced by the declaration", async () => {
		const ctx = buildContext(world, [new CountingStepper()]);
		const inst = await createChainInstance(world, ISSUER_DOMAIN, countingMichi);
		const advanced = await advanceChainInstance(ctx, inst.id, { count: 3 });
		expect(advanced.kind).toBe("completed");
		if (advanced.kind !== "completed") throw new Error("unreachable");
		expect(advanced.instance.stepArgs[0], "the walk records the step's coerced arguments").toEqual({ count: 3 });
	});
});
