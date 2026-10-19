import { it, expect, describe, vi } from "vitest";

import { DEF_PROTO_OPTIONS, getTestWorldWithOptions, testWithWorld } from "../lib/test/lib.js";
import DebuggerStepper, { TDebuggingType } from "./debugger-stepper.js";
import Haibun from "./haibun-stepper.js";
import type { IPrompter, TPrompt, TPromptResponse } from "../lib/prompts/ports.js";
import { ReadlinePrompter } from "../lib/prompts/adapters/readline-prompter.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { actionNotOK } from "../lib/domains/util.js";
import { OK } from "../lib/domains/protocol.js";
import { dispatchStep } from "../lib/actuality/pipelines/step-dispatch.js";
import { buildFeatureStepForTransport } from "../lib/steps/pipelines/call-step.js";
import { StepRegistry } from "../lib/steps/pipelines/step-registry.js";
import { addStepperConcerns } from "../lib/actuality/pipelines/executor.js";
import { DOMAIN_TEXT } from "../lib/domains/domains.js";
import { itemAt } from "../lib/domains/item-at.js";

class TestPrompter implements IPrompter {
	prompt = (_p: TPrompt) => Promise.resolve("continue");
	cancel = () => {
		/* empty */
	};
	resolve: (id: string, value: TPromptResponse) => void = () => {
		/* empty */
	};
}

describe("DebuggerStepper", () => {
	it("runs debug step by step", async () => {
		const feature = { path: "/features/test.feature", content: "debug step by step\nThis should be prompted." };
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new TestPrompter();
		vi.spyOn(testPrompter, "prompt");
		world.prompter.subscribe(testPrompter);
		const res = await testWithWorld(world, [feature], [DebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});

	it("passes correct options to prompter for debug step by step", async () => {
		const feature = { path: "/features/test.feature", content: "debug step by step\nThis should be prompted." };
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new TestPrompter();
		const spy = vi.spyOn(testPrompter, "prompt");
		world.prompter.subscribe(testPrompter);

		await testWithWorld(world, [feature], [DebuggerStepper, Haibun]);

		expect(spy).toHaveBeenCalledTimes(1);
		const promptCall = itemAt(spy.mock.calls, 0)[0];
		expect(promptCall.options).toEqual(["*", "step", "continue"]);
	});

	it("continues", async () => {
		class ContinueDebuggerStepper extends DebuggerStepper {
			constructor() {
				super();
				this.debuggingType = TDebuggingType.Continue;
			}
		}
		const feature = { path: "/features/test.feature", content: "debug step by step\ncontinue\n;; step" };
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new TestPrompter();
		vi.spyOn(testPrompter, "prompt");
		world.prompter.subscribe(testPrompter);
		const res = await testWithWorld(world, [feature], [ContinueDebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});
});

describe("DebuggerStepper sequence integration", () => {
	it("beforeStep: proves each command typed at the prompt under the line", async () => {
		class SequenceTestPrompter implements IPrompter {
			responses = [";;comment 1", ";;comment 2", "step", "step", "continue"];
			idx = 0;
			prompt = () => {
				const response = this.responses[this.idx++];
				return Promise.resolve(response);
			};
			cancel = () => {
				/* empty */
			};
			resolve: (_id: string, _value: unknown) => void = () => {
				/* empty */
			};
		}
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new SequenceTestPrompter();
		world.prompter.subscribe(testPrompter);
		const feature = { path: "/features/test.feature", content: "debug step by step\nThis should be prompted.\nAnother step." };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, Haibun]);
		expect(res.ok).toBe(true);
		// seqPath format: [hostId, featureNum, scenarioNum, stepSeq, ...]
		// [0,1,0,1] debug step by step, [0,1,0,2,1] comment 1, [0,1,0,2,2] comment 2, [0,1,0,2,3] step (exits loop), [0,1,0,2] step 2, [0,1,0,3,1] step (exits loop), [0,1,0,3] step 3
		const seqs = itemAt(res.featureResults, 0).stepResults.map((r) => r.seqPath);
		expect(seqs).toEqual([
			[0, 1, 0, 1],
			[0, 1, 0, 2, 1],
			[0, 1, 0, 2, 2],
			[0, 1, 0, 2, 3],
			[0, 1, 0, 2],
			[0, 1, 0, 3, 1],
			[0, 1, 0, 3],
		]);
	});

	it("afterStep: proves each command typed at the failure prompt under the line", async () => {
		const TestSteps = (await import("../lib/test/TestSteps.js")).default;
		class FailurePrompter implements IPrompter {
			responses = [";;comment 1", ";;comment 2", "next"];
			idx = 0;
			prompt = () => Promise.resolve(this.responses[this.idx++]);
			cancel = () => {
				/* empty */
			};
			resolve: (_id: string, _value: unknown) => void = () => {
				/* empty */
			};
		}
		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new FailurePrompter();
		world.prompter.subscribe(testPrompter);
		// Use TestSteps' fails action
		const feature = { path: "/features/test.feature", content: "fails" };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, TestSteps, Haibun]);
		expect(res.ok).toBe(true); // 'next' allows continuation
		// [0,1,0,1] failed step, [0,1,0,1,1] comment 1, [0,1,0,1,2] comment 2, [0,1,0,1,3] next (exits loop)
		const seqs = itemAt(res.featureResults, 0).stepResults.map((r) => r.seqPath);
		expect(seqs).toEqual([
			[0, 1, 0, 1],
			[0, 1, 0, 1, 1],
			[0, 1, 0, 1, 2],
			[0, 1, 0, 1, 3],
		]);
	});

	it("pauses before a line and not before a call nested in its proof", async () => {
		const TestSteps = (await import("../lib/test/TestSteps.js")).default;

		class LimitedPrompter implements IPrompter {
			callCount = 0;
			prompt = () => {
				this.callCount++;
				// The first prompt is for the line 'not fails', and the nested 'fails' doesn't prompt.
				if (this.callCount > 1) {
					throw new Error("the debugger paused before a call nested in a line's proof");
				}
				return Promise.resolve("step");
			};
			cancel = () => {
				/* empty */
			};
			resolve: (_id: string, _value: unknown) => void = () => {
				/* empty */
			};
		}

		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const testPrompter = new LimitedPrompter();
		vi.spyOn(testPrompter, "prompt");
		world.prompter.subscribe(testPrompter);

		// 'not fails' holds: the nested 'fails' is refuted.
		const feature = { path: "/features/test.feature", content: "debug step by step\nnot fails" };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, TestSteps, Haibun]);

		// One prompt, for 'not fails'. 'debug step by step' sets the mode without a prompt.
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});
});

describe("DebuggerStepper RPC dispatch", () => {
	// buildFeatureStepForTransport stamps source.path === "rpc" on every transport-
	// driven dispatch. Those callers don't have a human at the prompter, so the
	// debugger's before/afterStep hooks must not enter debugLoop, otherwise
	// prompter.prompt() awaits forever, stepEnd never fires, and the caller hangs.
	// Regression for the "fetching forever" symptom of a missing-node RPC.

	it("does not prompt on actionNotOK when dispatched via RPC transport", async () => {
		const failing = new (class extends AStepper {
			description = "A step that always fails.";
			steps = { alwaysFails: { gwta: "always fails", action: async () => actionNotOK("intentional failure") } };
		})();

		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const trap: IPrompter = {
			prompt: () => {
				throw new Error("Debugger entered debugLoop on RPC dispatch, prompter must not be called for source.path === 'rpc'");
			},
			cancel: () => undefined,
			resolve: () => undefined,
		};
		world.prompter.subscribe(trap);

		const debuggerStepper = new DebuggerStepper();
		const steppers = [debuggerStepper, failing];
		await debuggerStepper.setWorld(world, steppers);
		addStepperConcerns(world, steppers);
		const registry = new StepRegistry(steppers, world);
		const tool = registry.get(`${failing.constructor.name}-alwaysFails`);
		if (!tool) throw new Error("alwaysFails not registered");

		const featureStep = buildFeatureStepForTransport(tool, {}, [0, 99]);
		expect(featureStep.programmatic).toBe(true);
		const result = await dispatchStep({ registry, world, steppers, grantedCapability: tool.descriptor.capability }, featureStep);
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toBe("intentional failure");
	});

	it("does not prompt before step-by-step RPC dispatch", async () => {
		const echo = new (class extends AStepper {
			description = "A step that echoes a text.";
			steps = { echo: { gwta: `echo {what: ${DOMAIN_TEXT}}`, action: async () => OK } };
		})();

		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const trap: IPrompter = {
			prompt: () => {
				throw new Error("Debugger entered beforeStep debugLoop on RPC dispatch with StepByStep mode");
			},
			cancel: () => undefined,
			resolve: () => undefined,
		};
		world.prompter.subscribe(trap);

		const debuggerStepper = new DebuggerStepper();
		debuggerStepper.debuggingType = TDebuggingType.StepByStep;
		const steppers = [debuggerStepper, echo];
		await debuggerStepper.setWorld(world, steppers);
		addStepperConcerns(world, steppers);
		const registry = new StepRegistry(steppers, world);
		const tool = registry.get(`${echo.constructor.name}-echo`);
		if (!tool) throw new Error("echo not registered");

		const featureStep = buildFeatureStepForTransport(tool, { what: "hi" }, [0, 100]);
		const result = await dispatchStep({ registry, world, steppers, grantedCapability: tool.descriptor.capability }, featureStep);
		expect(result.ok).toBe(true);
	});
});
