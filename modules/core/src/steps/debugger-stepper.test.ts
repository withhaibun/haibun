import { it, expect, describe, vi } from "vitest";

import { DEF_PROTO_OPTIONS, getTestWorldWithOptions, testWithWorld } from "../lib/test/lib.js";
import DebuggerStepper, { TDebuggingType } from "./debugger-stepper.js";
import Haibun from "./haibun.js";
import { IPrompter, TPrompt, TPromptResponse } from "../lib/prompter.js";
import { ReadlinePrompter } from "../lib/readline-prompter.js";
import { AStepper } from "../lib/astepper.js";
import { actionNotOK } from "../lib/util/index.js";
import { buildFeatureStepForTransport, dispatchStep, StepRegistry } from "../lib/step-dispatch.js";

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
		const promptCall = spy.mock.calls[0][0];
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
	it("beforeStep: increments seqPath with negative inc for debug prompts", async () => {
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
		// [0,1,1,1] debug step by step, [0,1,1,2,-1] comment 1, [0,1,1,2,-2] comment 2, [0,1,1,2,-3] step (exits loop), [0,1,1,2] step 2, [0,1,1,3,-1] step (exits loop), [0,1,1,3] step 3
		const seqs = res.featureResults?.[0].stepResults.map((r) => r.seqPath);
		expect(seqs).toEqual([
			[0, 1, 1, 1],
			[0, 1, 1, 2, -1],
			[0, 1, 1, 2, -2],
			[0, 1, 1, 2, -3],
			[0, 1, 1, 2],
			[0, 1, 1, 3, -1],
			[0, 1, 1, 3],
		]);
	});

	it("afterStep: increments seqPath with positive inc for failure prompts", async () => {
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
		// [0,1,1,1] failed step, [0,1,1,1,1] comment 1, [0,1,1,1,2] comment 2, [0,1,1,1,3] next (exits loop)
		const seqs = res.featureResults?.[0].stepResults.map((r) => r.seqPath);
		expect(seqs).toEqual([
			[0, 1, 1, 1],
			[0, 1, 1, 1, 1],
			[0, 1, 1, 1, 2],
			[0, 1, 1, 1, 3],
		]);
	});

	it("does not trigger debugger for speculative failures", async () => {
		const TestSteps = (await import("../lib/test/TestSteps.js")).default;
		const LogicStepper = (await import("./logic-stepper.js")).default;

		class LimitedPrompter implements IPrompter {
			callCount = 0;
			prompt = () => {
				this.callCount++;
				// Allow the first prompt (for 'not fails')
				// but any additional prompts (like for speculative 'fails') should not happen
				if (this.callCount > 1) {
					throw new Error("Debugger should not be triggered for speculative failures");
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

		// Use 'not fails' - the inner 'fails' step runs speculatively and fails, but 'not' succeeds
		const feature = { path: "/features/test.feature", content: "debug step by step\nnot fails" };
		const res = await testWithWorld(world, [feature], [DebuggerStepper, TestSteps, LogicStepper, Haibun]);

		// Should succeed with exactly 1 debugger prompt (for 'not fails')
		// but NOT for the inner speculative 'fails' step
		// ('debug step by step' doesn't trigger a prompt, it just sets the mode)
		expect(res.ok).toBe(true);
		expect(testPrompter.prompt).toHaveBeenCalledTimes(1);
	});
});

describe("DebuggerStepper RPC dispatch", () => {
	// buildFeatureStepForTransport stamps source.path === "rpc" on every transport-
	// driven dispatch. Those callers have no human at the prompter, so the
	// debugger's before/afterStep hooks must not enter debugLoop — otherwise
	// prompter.prompt() awaits forever, stepEnd never fires, and the caller hangs.
	// Regression for the "fetching forever" symptom of a missing-vertex RPC.

	it("does not prompt on actionNotOK when dispatched via RPC transport", async () => {
		const failing = new (class extends AStepper {
			steps = {
				alwaysFails: {
					gwta: "always fails",
					action: async () => actionNotOK("intentional failure"),
				},
			};
		})();

		const world = getTestWorldWithOptions(DEF_PROTO_OPTIONS);
		world.prompter.unsubscribe(new ReadlinePrompter());
		const trap: IPrompter = {
			prompt: () => {
				throw new Error("Debugger entered debugLoop on RPC dispatch — prompter must not be called for source.path === 'rpc'");
			},
			cancel: () => undefined,
			resolve: () => undefined,
		};
		world.prompter.subscribe(trap);

		const debuggerStepper = new DebuggerStepper();
		const steppers = [debuggerStepper, failing];
		await debuggerStepper.setWorld(world, steppers);
		const registry = new StepRegistry(steppers, world);
		const tool = registry.get(`${failing.constructor.name}-alwaysFails`);
		if (!tool) throw new Error("alwaysFails not registered");

		const featureStep = buildFeatureStepForTransport(tool, {}, [0, 99]);
		expect(featureStep.programmatic).toBe(true);
		const result = await dispatchStep({ registry, world, steppers }, featureStep);
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toBe("intentional failure");
	});

	it("does not prompt before step-by-step RPC dispatch", async () => {
		const echo = new (class extends AStepper {
			steps = {
				echo: {
					gwta: "echo {what: string}",
					action: async ({ what }: { what: string }) => ({ ok: true, products: { echoed: what } }),
				},
			};
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
		const registry = new StepRegistry(steppers, world);
		const tool = registry.get(`${echo.constructor.name}-echo`);
		if (!tool) throw new Error("echo not registered");

		const featureStep = buildFeatureStepForTransport(tool, { what: "hi" }, [0, 100]);
		const result = await dispatchStep({ registry, world, steppers }, featureStep);
		expect(result.ok).toBe(true);
	});
});
