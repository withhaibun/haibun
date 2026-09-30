// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SHOW_STEPS_METHOD } from "@haibun/core/lib/step-discovery.js";
import { findStep, getAvailableSteps, onStepsChanged } from "./rpc-registry.js";
import { setupShuTest, stepsChanged, stepsShown, type TShuTestHandle } from "./test-setup.js";
import { setDeviceStore, MemoryDeviceStore } from "./client-cache/index.js";
import { endPage } from "./page-pinned.js";

const aStep = (stepName: string) => ({ method: `RunSteps-${stepName}`, stepperName: "RunSteps", stepName, pattern: stepName });
const methodsOf = async () => (await getAvailableSteps()).map((step) => step.method);
/** Resolves with the methods the page holds once it holds the method given. */
const heldOnceItHolds = (method: string) =>
	new Promise<string[]>((resolve) => {
		onStepsChanged(async () => {
			const methods = await methodsOf();
			if (methods.includes(method)) resolve(methods);
		});
	});

describe("the steps a page holds", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		setDeviceStore(new MemoryDeviceStore());
	});
	afterEach(() => {
		handle?.teardown();
	});

	it("are read again when actuality signals its steps changed, and a view is told once they are read", async () => {
		let declared = [aStep("passes")];
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(declared) : undefined) });
		expect(await methodsOf()).toEqual(["RunSteps-passes"]);
		declared = [aStep("passes"), aStep("fails")];
		const held = heldOnceItHolds("RunSteps-fails");
		stepsChanged(handle, 1);
		expect(await held).toEqual(["RunSteps-passes", "RunSteps-fails"]);
	});

	it("are read again when the stream opens after the page began reading them, as it does after a break", async () => {
		let declared = [aStep("passes")];
		handle = setupShuTest({ dispatch: (method) => (method === SHOW_STEPS_METHOD ? stepsShown(declared) : undefined) });
		expect(await methodsOf()).toEqual(["RunSteps-passes"]);
		const held = heldOnceItHolds("RunSteps-fails");
		handle.eventStream.disconnect();
		declared = [aStep("passes"), aStep("fails")];
		handle.eventStream.reconnect();
		expect(await held).toEqual(["RunSteps-passes", "RunSteps-fails"]);
	});

	it("are read again after a read under way when actuality signals a change during that read", async () => {
		let declared = [aStep("passes")];
		let release = (): void => undefined;
		let reads = 0;
		handle = setupShuTest({
			dispatch: (method) => {
				if (method !== SHOW_STEPS_METHOD) return undefined;
				const answer = stepsShown(declared);
				// The second read is held until the test releases it, so actuality changes its steps while it is under way.
				if (++reads !== 2) return answer;
				return new Promise((resolve) => (release = () => resolve(answer)));
			},
		});
		expect(await methodsOf()).toEqual(["RunSteps-passes"]);
		const held = heldOnceItHolds("RunSteps-fails");
		stepsChanged(handle, 1);
		await expect.poll(() => reads).toBe(2);
		expect(findStep("RunSteps-passes"), "the page finds the steps it holds while it reads them again").toBeDefined();
		declared = [aStep("passes"), aStep("fails")];
		stepsChanged(handle, 2);
		release();
		expect(await held).toEqual(["RunSteps-passes", "RunSteps-fails"]);
	});

	it("are read once when the stream is open before the page first reads them, and again only when actuality signals they changed", async () => {
		let reads = 0;
		handle = setupShuTest({
			dispatch: (method) => {
				if (method !== SHOW_STEPS_METHOD) return undefined;
				reads++;
				return stepsShown([aStep("passes")]);
			},
		});
		const toldAtRead: number[] = [];
		const toldOfTheChange = new Promise<void>((resolve) =>
			onStepsChanged(() => {
				toldAtRead.push(reads);
				if (reads === 2) resolve();
			}),
		);
		await methodsOf();
		handle.emit({ id: "pause-1", timestamp: Date.now(), kind: "control", level: "debug", signal: "pause" });
		stepsChanged(handle, 1);
		await toldOfTheChange;
		expect(toldAtRead, "a view is told once, of the read the change caused").toEqual([2]);
	});
});
