import { describe, it, expect, beforeEach } from "vitest";
import { getDefaultWorld } from "./test/lib.js";
import type { TWorld } from "./world.js";
import type { TMichi } from "./goal-resolver.js";
import {
	CHAIN_INSTANCE_GRAPH,
	CHAIN_INSTANCE_STATUS,
	createChainInstance,
	deleteChainInstance,
	getChainInstance,
	listChainInstances,
	updateChainInstance,
} from "./chain-instance.js";

const sampleMichi: TMichi = {
	steps: [
		{ stepperName: "Issue", stepName: "issueCredential", gwta: "issue credential" },
		{ stepperName: "Verify", stepName: "verifyCredential", gwta: "verify credential" },
	],
	bindings: [{ kind: "argument", domain: "issuer" }],
};

describe("chain-instance", () => {
	let world: TWorld;
	beforeEach(() => {
		world = getDefaultWorld();
	});

	it("seeds a new instance with one quad per declared predicate and returns the assembled value", async () => {
		const inst = await createChainInstance(world, "credential-verified", sampleMichi);
		expect(inst.id).toMatch(/^ci_/);
		expect(inst.goal).toBe("credential-verified");
		expect(inst.michi.steps).toHaveLength(2);
		expect(inst.stepIndex).toBe(0);
		expect(inst.status).toBe(CHAIN_INSTANCE_STATUS.PENDING);
		expect(inst.stepArgs).toEqual([{}, {}]);
		expect(inst.stepFactIds).toEqual([[], []]);
		const quads = await world.shared.getStore().query({ namedGraph: CHAIN_INSTANCE_GRAPH, subject: inst.id });
		expect(quads.length).toBeGreaterThanOrEqual(8);
	});

	it("reads an instance back from the quad store", async () => {
		const created = await createChainInstance(world, "credential-verified", sampleMichi);
		const loaded = await getChainInstance(world, created.id);
		expect(loaded).toBeDefined();
		expect(loaded?.goal).toBe("credential-verified");
		expect(loaded?.michi.steps[0]?.stepperName).toBe("Issue");
	});

	it("getChainInstance returns undefined for an unknown id (no throw)", async () => {
		const result = await getChainInstance(world, "ci_does_not_exist");
		expect(result).toBeUndefined();
	});

	it("updateChainInstance only writes the supplied predicates and refreshes updatedAt", async () => {
		const inst = await createChainInstance(world, "credential-verified", sampleMichi);
		const before = inst.updatedAt;
		await new Promise((r) => setTimeout(r, 5));
		await updateChainInstance(world, inst.id, { stepIndex: 1, status: CHAIN_INSTANCE_STATUS.RUNNING, stepFactIds: [["chain/ci_x/0"], []] });
		const after = await getChainInstance(world, inst.id);
		expect(after?.stepIndex).toBe(1);
		expect(after?.status).toBe(CHAIN_INSTANCE_STATUS.RUNNING);
		expect(after?.stepFactIds[0]).toEqual(["chain/ci_x/0"]);
		expect(after?.updatedAt).toBeGreaterThan(before);
		expect(after?.goal).toBe("credential-verified");
	});

	it("listChainInstances returns every instance the store carries", async () => {
		const a = await createChainInstance(world, "goal-a", sampleMichi);
		const b = await createChainInstance(world, "goal-b", sampleMichi);
		const all = await listChainInstances(world);
		const ids = all.map((i) => i.id).sort();
		expect(ids).toEqual([a.id, b.id].sort());
	});

	it("deleteChainInstance removes every predicate for that instance", async () => {
		const inst = await createChainInstance(world, "credential-verified", sampleMichi);
		await deleteChainInstance(world, inst.id);
		const remaining = await world.shared.getStore().query({ namedGraph: CHAIN_INSTANCE_GRAPH, subject: inst.id });
		expect(remaining).toEqual([]);
		const reloaded = await getChainInstance(world, inst.id);
		expect(reloaded).toBeUndefined();
	});

});
