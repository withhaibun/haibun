/**
 * Tests the capability gate on supervising a process through real dispatch with a real authority.
 *
 * The supervisor's steps fork a process on this machine, so these tests cover the refusals. The steppers are the
 * production steppers. The gate refuses a call before a process starts. A call expected to pass the gate targets a
 * directory without a config.json. The supervisor's error about that directory shows that the call passed the gate. A
 * refused call fails with a capability error instead.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper from "./test-runner-stepper.js";
import InstanceStepper from "./instance-stepper.js";
import { SUPERVISOR_CAPABILITIES } from "./domains/run.js";
import { openRunRegistry } from "@haibun/core/lib/step-registry.js";
import { callStepByName } from "@haibun/core/lib/call-step.js";
import { runAuthorizedWith } from "@haibun/core/lib/domains/capability-context.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { addStepperConcerns } from "@haibun/core/phases/Executor.js";
import { QuadStore, newStoreChain } from "@haibun/core/lib/quad-store.js";
import { principalDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";

const NOWHERE = "/nonexistent-base-for-capability-tests";

/** Builds a world from getDefaultWorld and gives it a store, without a type assertion. */
function supervisedWorld(): TWorld {
	const world = getDefaultWorld();
	const store = new QuadStore(newStoreChain());
	world.shared.getStore = () => store;
	// Actuality registers the Principal domain through a stepper that this harness doesn't load.
	world.domains = { ...world.domains, ...mapDefinitionsToDomains([principalDomainDefinition]) };
	return world;
}

function harness() {
	const world = supervisedWorld();
	const steppers = [new TestRunnerStepper(), new InstanceStepper()];
	// The registry resolves each step's products domain through the world. addStepperConcerns registers the steppers'
	// declared domains in the world, as Runner does in its Concerns phase.
	addStepperConcerns(world, steppers);
	for (const s of steppers) void s.setWorld(world, steppers);
	// Opens the registry the way the Executor opens it. A step calls another step through this registry.
	const registry = openRunRegistry(world, steppers);
	/** Calls a step by name through callStepByName, as a caller without a feature file does. Held actions authorize the
	 *  call the way they authorize a statement narrowed to them. A grantedCapability authorizes the call the way an RPC
	 *  or MCP caller is authorized. */
	const call = async (method: string, input: Record<string, unknown> = {}, held?: string[], grantedCapability?: string) => {
		const dispatch = () => callStepByName({ registry, world, steppers, grantedCapability }, method, input);
		return held ? await runAuthorizedWith(held, dispatch) : await dispatch();
	};
	return { world, call };
}

describe("what a caller must hold to run a test", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it("refuses to start a run without a capability", async () => {
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" })).rejects.toThrow(new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`));
	});

	it("allows a caller that holds only the action that starts a run, and the call fails on the missing base rather than on authority", async () => {
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, [SUPERVISOR_CAPABILITIES.run]);
		expect(called.result.ok, "the base doesn't exist").toBe(false);
		expect(called.result.errorMessage, "the call reached the supervisor, so it passed the gate").toMatch(/doesn't hold a config.json/);
	});

	it("gates each action separately: the read action doesn't allow starting a run", async () => {
		const reader = [SUPERVISOR_CAPABILITIES.read];
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, reader)).rejects.toThrow(new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`));
		const read = await h.call("TestRunnerStepper-readTestRun", {}, reader);
		expect(read.result.errorMessage, "the read passed the gate and didn't find a test run to read").toMatch(/doesn't have a test run to read/);
	});

	it("refuses a capability the agent names for itself, because the gate requires the supervisor's own action", async () => {
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, ["TestRunner:run"])).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("gates the supervisor's own steps the same way, so a direct call to the supervisor doesn't bypass the agent's limits", async () => {
		await expect(h.call("InstanceStepper-startRun", { where: NOWHERE, filter: "any", port: 0, run: "r" })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
		await expect(h.call("InstanceStepper-startInstance", { where: NOWHERE, port: 8999, hostId: 9 })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.launch} required`),
		);
	});

	it("doesn't widen a caller's authority when capability fields are written to the world, because the gate doesn't read authorization from the world", async () => {
		Object.assign(h.world.runtime, { activeCapability: "Instance:*", capability: "Instance:*", grantedCapability: "Instance:*" });
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, [SUPERVISOR_CAPABILITIES.read])).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("carries the caller's authority into the step the tool calls, so a wrapper doesn't gain or lose authority", async () => {
		// An explicit capability authorizes the agent's tool, as it authorizes an RPC or MCP caller. The tool's inner call to
		// the supervisor runs under the same authority.
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, undefined, SUPERVISOR_CAPABILITIES.run);
		expect(called.result.errorMessage, "the outer call's authority authorized the inner call").toMatch(/doesn't hold a config.json/);
	});
});
