/**
 * The capability gate on supervising a process, exercised through real dispatch with a real authority.
 *
 * These are the steps that fork a process on this machine, so the interesting cases are the refusals. The steppers
 * here are the real ones. The run is refused before anything is started, and where a call is expected to pass the
 * gate it is aimed at a directory holding no config, so what proves authorization is the supervisor's own complaint
 * about the directory rather than a capability error.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper from "./test-runner-stepper.js";
import InstanceStepper, { SUPERVISOR_CAPABILITIES } from "./instance-stepper.js";
import { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { callStepByName } from "@haibun/core/lib/call-step.js";
import { ZcapAuthority, ZCAP_AUTHORITY, ZCAP_TOKEN_KEY } from "@haibun/core/lib/zcap-authority.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { principalDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import type { TWorld } from "@haibun/core/lib/world.js";

const AGENT_TOKEN = "agent-token";
const NOWHERE = "/nonexistent-base-for-capability-tests";

/** A world holding an authority and a store, assembled from the defaults rather than asserted into shape. */
function supervisedWorld(authority: ZcapAuthority): TWorld {
	const world = getDefaultWorld();
	const store = new QuadStore();
	world.shared.getStore = () => store;
	world.domains = mapDefinitionsToDomains([principalDomainDefinition]);
	(world.runtime.keys ??= {})[ZCAP_AUTHORITY] = authority;
	return world;
}

function harness() {
	const authority = new ZcapAuthority();
	const world = supervisedWorld(authority);
	const steppers = [new TestRunnerStepper(), new InstanceStepper()];
	for (const s of steppers) void s.setWorld(world, steppers);
	const registry = new StepRegistry(steppers, world);
	/** Call a step the way anything calls a step: under whatever token is active, with no capability asserted by the caller. */
	const call = async (method: string, input: Record<string, unknown> = {}, token?: string, grantedCapability?: string) => {
		if (token) (world.runtime.keys ??= {})[ZCAP_TOKEN_KEY] = token;
		else delete world.runtime.keys?.[ZCAP_TOKEN_KEY];
		return await callStepByName({ registry, world, steppers, grantedCapability }, method, input);
	};
	const grant = (action: string) => authority.issueBearerGrant({ token: AGENT_TOKEN, allowedAction: [action], controller: "did:site:test" });
	return { authority, world, call, grant };
}

describe("what a caller must hold to run a test", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
	});

	it("refuses to start a run with no capability at all", async () => {
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" })).rejects.toThrow(new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`));
	});

	it("allows it under a grant for exactly that action, and the run is refused for its own reasons rather than for authority", async () => {
		h.grant(SUPERVISOR_CAPABILITIES.run);
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, AGENT_TOKEN);
		expect(called.registered).toBe(true);
		if (!called.registered) return;
		expect(called.result.ok, "nothing is there to run").toBe(false);
		expect(called.result.errorMessage, "the supervisor was reached, which is what authorization means here").toMatch(/no config.json/);
	});

	it("grants one power at a time: reading a run is not starting one", async () => {
		h.grant(SUPERVISOR_CAPABILITIES.read);
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, AGENT_TOKEN)).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
		const read = await h.call("TestRunnerStepper-readTestRun", {}, AGENT_TOKEN);
		expect(read.registered && read.result.errorMessage, "the read passed the gate and found nothing to read").toMatch(/nothing to read/);
	});

	it("stops allowing it the moment the grant is revoked", async () => {
		h.grant(SUPERVISOR_CAPABILITIES.run);
		const before = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, AGENT_TOKEN);
		expect(before.registered && before.result.errorMessage).toMatch(/no config.json/);
		h.authority.revokeBearerGrant(AGENT_TOKEN);
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "other" }, AGENT_TOKEN)).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("is not reachable through the agent by a capability the agent named for itself: the power gated is the power exercised", async () => {
		h.grant("TestRunner:run");
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, AGENT_TOKEN)).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("gates the supervisor's own steps the same way, so calling it directly is no way around the agent's limits", async () => {
		await expect(h.call("InstanceStepper-startRun", { where: NOWHERE, filter: "any", port: 0, run: "r" })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
		await expect(h.call("InstanceStepper-startInstance", { where: NOWHERE, port: 8999, hostId: 9 })).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.launch} required`),
		);
	});

	it("cannot be widened by writing to the world: the authorization of a running step is not a field on it", async () => {
		h.grant(SUPERVISOR_CAPABILITIES.read);
		Object.assign(h.world.runtime, { activeCapability: "Instance:*", capability: "Instance:*", grantedCapability: "Instance:*" });
		await expect(h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, AGENT_TOKEN)).rejects.toThrow(
			new RegExp(`capability ${SUPERVISOR_CAPABILITIES.run} required`),
		);
	});

	it("carries the caller's authority into the step the tool calls through to, so a wrapper neither gains nor loses it", async () => {
		// The agent's tool is authorized by an explicit capability rather than by a token, as an RPC or MCP caller
		// reaches it. Its inner call to the supervisor must run under that same authority, with no token in sight.
		const called = await h.call("TestRunnerStepper-runTest", { where: NOWHERE, filter: "any" }, undefined, SUPERVISOR_CAPABILITIES.run);
		expect(called.registered && called.result.errorMessage, "the inner call was authorized by what authorized the outer one").toMatch(/no config.json/);
	});
});
