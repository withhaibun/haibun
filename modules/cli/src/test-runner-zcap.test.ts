/**
 * The capability gate on supervising a process, exercised through real dispatch with a real authority.
 *
 * These are the steps that fork a process on this machine, so the interesting cases are the refusals. The steppers
 * here are the real ones. The run is refused before anything is started, and where a call is expected to pass the
 * gate it is aimed at a directory without a config, so what proves authorization is the supervisor's own complaint
 * about the directory rather than a capability error.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper from "./test-runner-stepper.js";
import InstanceStepper, { SUPERVISOR_CAPABILITIES } from "./instance-stepper.js";
import { openRunRegistry } from "@haibun/core/lib/step-registry.js";
import { callStepByName } from "@haibun/core/lib/call-step.js";
import { runAuthorizedWith } from "@haibun/core/lib/capability-context.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { addStepperConcerns } from "@haibun/core/phases/Executor.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { principalDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";

const NOWHERE = "/nonexistent-base-for-capability-tests";

/** A world holding a store, assembled from the defaults rather than asserted into shape. */
function supervisedWorld(): TWorld {
	const world = getDefaultWorld();
	const store = new QuadStore();
	world.shared.getStore = () => store;
	// A run registers Principal through a stepper this harness doesn't load.
	world.domains = { ...world.domains, ...mapDefinitionsToDomains([principalDomainDefinition]) };
	return world;
}

function harness() {
	const world = supervisedWorld();
	const steppers = [new TestRunnerStepper(), new InstanceStepper()];
	// The registry resolves each step's products domain through the world, where a run registers what its steppers declare.
	addStepperConcerns(world, steppers);
	for (const s of steppers) void s.setWorld(world, steppers);
	// The run's registry, as the executor opens it, which a step calls another step through.
	const registry = openRunRegistry(world, steppers);
	/** Call a step the way anything calls a step: as a caller holding the actions named, as a statement narrowed to them
	 *  runs, without a capability asserted by the caller. */
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

	it("allows it to a caller holding exactly that action, and the run is refused for its own reasons rather than for authority", async () => {
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, [SUPERVISOR_CAPABILITIES.run]);
		expect(called.registered).toBe(true);
		if (!called.registered) return;
		expect(called.result.ok, "the base doesn't exist").toBe(false);
		expect(called.result.errorMessage, "the supervisor was reached, which is what authorization means here").toMatch(/doesn't hold a config.json/);
	});

	it("holds one power at a time: reading a run is not starting one", async () => {
		const reader = [SUPERVISOR_CAPABILITIES.read];
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, reader)).rejects.toThrow(new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`));
		const read = await h.call("TestRunnerStepper-readTestRun", {}, reader);
		expect(read.registered && read.result.errorMessage, "the read passed the gate and didn't find a run to read").toMatch(/nothing to read/);
	});

	it("is not reachable through the agent by a capability the agent named for itself: the power gated is the power exercised", async () => {
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, ["TestRunner:run"])).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("gates the supervisor's own steps the same way, so calling it directly doesn't bypass the agent's limits", async () => {
		await expect(h.call("InstanceStepper-startRun", { where: NOWHERE, filter: "any", port: 0, run: "r" })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
		await expect(h.call("InstanceStepper-startInstance", { where: NOWHERE, port: 8999, hostId: 9 })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.launch} required`),
		);
	});

	it("cannot be widened by writing to the world: the authorization of a running step is not a field on it", async () => {
		Object.assign(h.world.runtime, { activeCapability: "Instance:*", capability: "Instance:*", grantedCapability: "Instance:*" });
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, [SUPERVISOR_CAPABILITIES.read])).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("carries the caller's authority into the step the tool calls through to, so a wrapper doesn't gain or lose it", async () => {
		// The agent's tool is authorized by an explicit capability, as an RPC or MCP caller reaches it. Its inner call to the
		// supervisor must run under that same authority.
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, undefined, SUPERVISOR_CAPABILITIES.run);
		expect(called.registered && called.result.errorMessage, "the inner call was authorized by what authorized the outer one").toMatch(/doesn't hold a config.json/);
	});
});
