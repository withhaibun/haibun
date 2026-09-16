// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STEPS_CHANGED } from "@haibun/core/schema/protocol.js";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { getAvailableSteps, resetStepRegistry } from "./rpc-registry.js";
import { followStepChanges } from "./steps-changes.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "./test-setup.js";
import { setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";

const aStep = (stepName: string) => ({ method: `RunSteps-${stepName}`, stepperName: "RunSteps", stepName, pattern: stepName });
const methodsOf = async () => (await getAvailableSteps()).map((step) => step.method);

describe("the steps a page holds", () => {
	let handle: TShuTestHandle;
	let stopFollowing = (): void => undefined;
	beforeEach(() => {
		resetStepRegistry();
		setDeviceStore(new MemoryDeviceStore());
	});
	afterEach(() => {
		stopFollowing();
		handle?.teardown();
		resetStepRegistry();
	});

	it("are read again when the run signals its steps changed, and the page is told once they are read", async () => {
		let declared = [aStep("passes")];
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(declared) : undefined) });
		expect(await methodsOf()).toEqual(["RunSteps-passes"]);
		declared = [aStep("passes"), aStep("fails")];
		const reread = new Promise<string[]>((resolve) => {
			stopFollowing = followStepChanges(async () => resolve(await methodsOf()));
		});
		handle.emit({ id: `${STEPS_CHANGED}-1`, timestamp: Date.now(), kind: "control", level: "debug", signal: STEPS_CHANGED });
		expect(await reread).toEqual(["RunSteps-passes", "RunSteps-fails"]);
	});

	it("are read again when the stream comes back after a break, during which a change reached no page", async () => {
		let declared = [aStep("passes")];
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(declared) : undefined) });
		expect(await methodsOf()).toEqual(["RunSteps-passes"]);
		const reread = new Promise<string[]>((resolve) => {
			stopFollowing = followStepChanges(async () => resolve(await methodsOf()));
		});
		handle.eventStream.disconnect();
		declared = [aStep("passes"), aStep("fails")];
		handle.eventStream.reconnect();
		expect(await reread).toEqual(["RunSteps-passes", "RunSteps-fails"]);
	});

	it("are not read again for another signal", async () => {
		let reads = 0;
		handle = setupShuTest({
			dispatch: (method) => {
				if (method !== SHOW_STEPS_METHOD) return undefined;
				reads++;
				return stepsShown([aStep("passes")]);
			},
		});
		await methodsOf();
		stopFollowing = followStepChanges(() => undefined);
		handle.emit({ id: "pause-1", timestamp: Date.now(), kind: "control", level: "debug", signal: "pause" });
		await methodsOf();
		expect(reads).toBe(1);
	});
});
