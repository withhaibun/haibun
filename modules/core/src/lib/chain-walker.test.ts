import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { AStepper, type TStepperSteps } from "./astepper.js";
import { actionOKWithProducts, actionNotOK } from "./util/index.js";
import { buildStepRegistry, type StepRegistry } from "./step-dispatch.js";
import { registerDomains } from "./domains.js";
import { getDefaultWorld } from "./test/lib.js";
import type { TWorld } from "./world.js";
import { FACT_GRAPH } from "./working-memory.js";
import type { TMichi } from "./goal-resolver.js";
import { CHAIN_INSTANCE_STATUS, createChainInstance } from "./chain-instance.js";
import { advanceChainInstance } from "./chain-walker.js";

const ISSUER_DOMAIN = "issuer";
const VC_DOMAIN = "vc";

const IssuerSchema = z.object({ issuerId: z.string() });
const VcSchema = z.object({ vcId: z.string() });

class IssueStepper extends AStepper {
	steps: TStepperSteps = {
		issueCredential: {
			gwta: "issue credential",
			productsDomain: ISSUER_DOMAIN,
			action: ({ issuerId }: { issuerId: string }) => Promise.resolve(actionOKWithProducts({ issuerId: issuerId ?? "default-issuer" })),
		},
	};
}

class MintStepper extends AStepper {
	steps: TStepperSteps = {
		mintVc: {
			gwta: "mint a credential",
			productsDomain: VC_DOMAIN,
			action: () => Promise.resolve(actionOKWithProducts({ vcId: "vc-001" })),
		},
	};
}

class BrokenStepper extends AStepper {
	steps: TStepperSteps = {
		fail: {
			gwta: "fail",
			action: () => Promise.resolve(actionNotOK("intentional failure")),
		},
	};
}

function buildContext(world: TWorld, steppers: AStepper[]): { registry: StepRegistry; world: TWorld; steppers: AStepper[] } {
	registerDomains(world, [
		[
			{ selectors: [ISSUER_DOMAIN], schema: IssuerSchema, description: "issuer identity" },
			{ selectors: [VC_DOMAIN], schema: VcSchema, description: "verifiable credential" },
		],
	]);
	const registry = buildStepRegistry(steppers, world);
	return { registry, world, steppers };
}

const twoStepMichi: TMichi = {
	steps: [
		{ stepperName: "IssueStepper", stepName: "issueCredential", gwta: "issue credential" },
		{ stepperName: "MintStepper", stepName: "mintVc", gwta: "mint a credential" },
	],
	bindings: [{ kind: "argument", domain: ISSUER_DOMAIN }],
};

describe("chain-walker", () => {
	let world: TWorld;
	beforeEach(() => {
		world = getDefaultWorld();
	});

	it("advances one step at a time, recording the produced fact id per step", async () => {
		const ctx = buildContext(world, [new IssueStepper(), new MintStepper()]);
		const inst = await createChainInstance(world, VC_DOMAIN, twoStepMichi);

		const first = await advanceChainInstance(ctx, inst.id, { issuerId: "alice" });
		expect(first.kind).toBe("advanced");
		if (first.kind !== "advanced") throw new Error("unreachable");
		expect(first.instance.stepIndex).toBe(1);
		expect(first.instance.status).toBe(CHAIN_INSTANCE_STATUS.PENDING);
		expect(first.factIds).toHaveLength(1);
		const issuerFact = await world.shared.getStore().get(first.factIds[0], ISSUER_DOMAIN, FACT_GRAPH);
		expect(issuerFact).toMatchObject({ issuerId: "alice" });

		const second = await advanceChainInstance(ctx, inst.id, {});
		expect(second.kind).toBe("completed");
		if (second.kind !== "completed") throw new Error("unreachable");
		expect(second.instance.stepIndex).toBe(2);
		expect(second.instance.status).toBe(CHAIN_INSTANCE_STATUS.COMPLETED);
		expect(second.instance.stepFactIds[1]).toHaveLength(1);
	});

	it("flips status to failed when a step's action returns not-ok and stops the walk", async () => {
		const ctx = buildContext(world, [new BrokenStepper()]);
		const inst = await createChainInstance(world, "any-goal", { steps: [{ stepperName: "BrokenStepper", stepName: "fail" }], bindings: [] });
		const result = await advanceChainInstance(ctx, inst.id, {});
		expect(result.kind).toBe("failed");
		if (result.kind !== "failed") throw new Error("unreachable");
		expect(result.instance.status).toBe(CHAIN_INSTANCE_STATUS.FAILED);
		expect(result.error).toMatch(/intentional failure/);
	});

	it("returns failed when the named step is not in the registry (chain refers to a stepper that wasn't loaded)", async () => {
		const ctx = buildContext(world, [new IssueStepper()]);
		const inst = await createChainInstance(world, "any-goal", { steps: [{ stepperName: "NotRegistered", stepName: "nope" }], bindings: [] });
		const result = await advanceChainInstance(ctx, inst.id, {});
		expect(result.kind).toBe("failed");
		if (result.kind !== "failed") throw new Error("unreachable");
		expect(result.error).toMatch(/not registered/);
	});

	it("idempotently reports completion once every step has produced a fact", async () => {
		const ctx = buildContext(world, [new MintStepper()]);
		const inst = await createChainInstance(world, VC_DOMAIN, { steps: [{ stepperName: "MintStepper", stepName: "mintVc" }], bindings: [] });
		await advanceChainInstance(ctx, inst.id, {});
		const again = await advanceChainInstance(ctx, inst.id, {});
		expect(again.kind).toBe("completed");
		if (again.kind !== "completed") throw new Error("unreachable");
		expect(again.instance.status).toBe(CHAIN_INSTANCE_STATUS.COMPLETED);
	});
});
