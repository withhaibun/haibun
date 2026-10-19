import { describe, it, expect } from "vitest";
import { z } from "zod";

import { DEF_PROTO_OPTIONS, failWithDefaults, passWithDefaults } from "../lib/test/lib.js";
import { Resolver } from "../lib/actuality/pipelines/resolver.js";
import TestSteps from "../lib/test/TestSteps.js";
import Haibun from "./haibun-stepper.js";
import VariablesSteppers from "./variables-stepper.js";
import { ActivitiesStepper } from "./activities-stepper.js";
import { AStepper } from "../lib/steps/domains/stepper.js";
import { actionOK } from "../lib/domains/util.js";
import { itemAt } from "../lib/domains/item-at.js";
import { hostScopedMethodName } from "../lib/steps/domains/step-method.js";
import { runRegistry, type StepRegistry } from "../lib/steps/pipelines/step-registry.js";
import { STEPS_CHANGED, type THaibunEvent } from "../lib/domains/protocol.js";
import { STEP_DETAIL, type TStepDefinitions } from "../lib/steps/domains/step-discovery.js";
import { readShownSteps } from "../lib/steps/domains/step-discovery.js";
import type { TStepResult } from "../lib/domains/protocol.js";
import { validateStep } from "../lib/pipelines/step-validation.js";
import { RUN_AUTHORITY, runAuthorizedWith, runShowing } from "../lib/domains/capability-context.js";
import { recordOf } from "../lib/records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "../lib/domains/resources.js";

describe("until", () => {
	it("passes once its statements pass", async () => {
		const feature = { path: "/features/test.feature", content: "until passes within 1 s" };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
	it("fails and states why when its statements haven't passed within the duration", async () => {
		const feature = { path: "/features/test.feature", content: 'until fails within "50ms"' };
		const result = await failWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
		expect(itemAt(result.featureResults, 0).stepResults.at(-1)).toMatchObject({ ok: false, errorMessage: expect.stringMatching(/didn't hold within 50ms/) });
	});
});

describe("duration of", () => {
	const PAUSED = '"30ms"';
	const PAUSED_MS = 30;
	const StepDurationSchema = z.object({ step: z.string(), called: z.string(), durationMs: z.number() });
	const EndedSchema = z.object({ called: z.string(), generatedAtTime: z.string(), endedAtTime: z.string() });
	/** The result of the feature's `duration of` step. A substep's result precedes it. */
	const durationStep = (result: { featureResults?: Array<{ stepResults: TStepResult[] }> }): TStepResult => {
		const found = itemAt(result.featureResults ?? [], 0).stepResults.find((stepResult) => stepResult.in.startsWith("duration of"));
		if (!found) throw new Error("the feature's results don't hold the duration of step");
		return found;
	};

	it("returns the duration of the statement's step from the step's record", async () => {
		const result = await passWithDefaults(`duration of pause for ${PAUSED}`, [Haibun]);
		const { step, called, durationMs } = StepDurationSchema.parse(durationStep(result).products);
		const ended = EndedSchema.parse(await recordOf(result.world.shared.getStore(), SEQ_PATH_LABEL, step));
		expect(called).toBe(ended.called);
		expect(durationMs).toBe(Date.parse(ended.endedAtTime) - Date.parse(ended.generatedAtTime));
		expect(durationMs).toBeGreaterThanOrEqual(PAUSED_MS);
	});

	it("sets a variable that a comparison reads", async () => {
		const result = await passWithDefaults([`set timed from duration of pause for ${PAUSED}`, `variable timed.durationMs is more than "${PAUSED_MS - 1}"`].join("\n"), [
			Haibun,
			VariablesSteppers,
		]);
		expect(result.ok).toBe(true);
	});

	it("fails where the statement's step fails", async () => {
		const result = await failWithDefaults("duration of fails", [Haibun, TestSteps]);
		expect(durationStep(result).errorMessage).toBe("duration of: the step failed: test fail");
	});
});

describe("on host", () => {
	it("routes a step to a hostId-prefixed registry entry", async () => {
		let remoteCalled = false;
		class RemoteMarker extends AStepper {
			description = "Injects a host-scoped copy of TestSteps-passes that records it was called.";
			attach(registry: StepRegistry) {
				const local = registry.get("TestSteps-passes");
				if (!local) return;
				registry.inject([
					{
						...local,
						descriptor: { ...local.descriptor, method: hostScopedMethodName(2, "TestSteps-passes") },
						handler: () => {
							remoteCalled = true;
							return Promise.resolve(actionOK());
						},
					},
				]);
			}
			detach() {
				// required by attachTransportsToRegistry duck-type check
			}
			steps = {};
		}

		const feature = { path: "/features/test.feature", content: "passes\non host 2, passes" };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, RemoteMarker]);
		expect(result.ok).toBe(true);
		const ins = itemAt(result.featureResults, 0).stepResults.map((r) => r.in);
		// The substep's record precedes the result of the `on host` step that wraps it.
		expect(ins).toEqual(["passes", "passes", "on host 2, passes"]);
		expect(remoteCalled, "the host-scoped entry ran").toBe(true);
	});

	it("fails and names the host-scoped method when a registry entry doesn't exist for the target hostId", async () => {
		const feature = { path: "/features/test.feature", content: "on host 9, passes" };
		const result = await failWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(false);
		const errors = itemAt(result.featureResults, 0).stepResults.flatMap((r) => (r.ok ? [] : [r.errorMessage]));
		expect(errors.some((e) => typeof e === "string" && e.includes(hostScopedMethodName(9, "TestSteps-passes")))).toBe(true);
	});
});

describe("seqPath ordering", () => {
	// seqPath format: [hostId, featureNum, scenarioNum, ...stepPath]
	// hostId: 0 by default; distinct per haibun instance for multi-host uniqueness
	// featureNum: 1-based feature number
	// scenarioNum: the scenario's ordinal among the feature's scenarios, 0 before the first scenario
	// stepPath: a line's number, followed by each position of its proof

	it("linear steps increment the last element of the seqPath", async () => {
		const feature = { path: "/features/test.feature", content: "passes\npasses\npasses" };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = itemAt(result.featureResults, 0).stepResults.map((r) => r.seqPath);
		expect(seqs).toEqual([
			[0, 1, 0, 1],
			[0, 1, 0, 2],
			[0, 1, 0, 3],
		]);
	});
});

describe("afterEvery", () => {
	it("afterEvery effect injects step", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", Noodles, man.\npasses\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const ins = itemAt(result.featureResults, 0).stepResults.map((r) => r.in);
		expect(ins).toEqual(["have a test", 'after every "TestSteps", Noodles, man.', "passes", "Noodles, man.", "passes", "Noodles, man."]);
	});

	it("fails a step whose after-every step fails, states why, and records the step before its after-every step", async () => {
		const feature = { path: "/features/test.feature", content: 'after every "TestSteps", fails\npasses' };
		const result = await failWithDefaults([feature], [Haibun, TestSteps]);
		const results = itemAt(result.featureResults, 0).stepResults;
		const passes = results.find((r) => r.in === "passes");
		expect(passes?.ok, "a cycle fails a step that passed").toBe(false);
		expect(passes?.errorMessage).toMatch(/a step run after every TestSteps step failed: /);
		expect(results.map((r) => r.in).slice(-2), "the step is recorded before the step its cycle ran").toEqual(["passes", "fails"]);
	});

	it("afterEvery effect injects hierarchical step with parent seqPath extended", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", passes\nhave a test\npasses' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const seqs = itemAt(result.featureResults, 0).stepResults.map((r) => r.seqPath);
		// An afterEvery statement is proved under the step it follows.
		// Step [0,1,0,4] "passes" doesn't run the after-every step, since the after-every step is the same action.
		expect(seqs).toEqual([
			[0, 1, 0, 1],
			[0, 1, 0, 2],
			[0, 1, 0, 3],
			[0, 1, 0, 3, 1],
			[0, 1, 0, 4],
		]);
	});

	it("runs once after a step of the feature and doesn't run after its substeps", async () => {
		const feature = { path: "/features/test.feature", content: ["have a test", 'after every "TestSteps", Noodles, man.', "passes", "not fails"].join("\n") };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const said = itemAt(result.featureResults, 0).stepResults.filter((r) => r.in === "Noodles, man.").length;
		expect(said, "the statement runs for the step the feature holds and doesn't run for the substep that another step ran").toBe(1);
	});
});

describe("line comment", () => {
	const NOTE = ";;unsetVariable is the text of a note";
	it("resolves a `;;` statement to the comment step instead of prose, and passes without resolving the variable that its text names", async () => {
		expect(new Resolver([new Haibun()], []).findSingleStepAction(NOTE).actionName).toBe("comment");
		expect((await passWithDefaults(NOTE, [Haibun])).ok).toBe(true);
	});
});

describe("prose", () => {
	it("mixed prose", async () => {
		const feature = {
			path: "/features/test.feature",
			content: `Haibun prose allows mixing text descriptions with a functional test.
When I have a test
Then it passes
Prose sections are indicated by the presence of punctuation at the end of paragraphs.`,
		};
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);

		expect(result.ok).toBe(true);

		expect(result.featureResults?.length).toBe(1);
	});

	it("process effect callback", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", passes' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		expect(itemAt(result.featureResults, 0).stepResults.length).toBe(2);
	});

	it("process multiple effect callbacks", async () => {
		const feature = { path: "/features/test.feature", content: 'have a test\nafter every "TestSteps", passes\nhave a test' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const rfzs = itemAt(result.featureResults, 0).stepResults;
		expect(rfzs.length).toBe(4);
	});
});

describe("the steps actuality holds", () => {
	it("are announced to actuality's subscribers with STEPS_CHANGED when a transport adds a step", async () => {
		const signals: string[] = [];
		class AddsAStep extends AStepper {
			description = "Adds a step to actuality's registry, as a transport adds another host's steps, and records actuality's signals.";
			cycles = { onEvent: (event: THaibunEvent) => void (event.kind === "control" && signals.push(event.signal)) };
			steps = {
				addsAStep: {
					gwta: "transport adds a step",
					action: () => {
						const registry = runRegistry(this.getWorld());
						const passes = registry.get("TestSteps-passes");
						if (!passes) throw new Error("TestSteps-passes is not registered");
						registry.inject([{ ...passes, descriptor: { ...passes.descriptor, method: hostScopedMethodName(9, "TestSteps-passes") } }]);
						return Promise.resolve(actionOK());
					},
				},
			};
		}
		const result = await passWithDefaults([{ path: "/features/test.feature", content: "passes\ntransport adds a step" }], [Haibun, TestSteps, AddsAStep]);
		expect(result.ok).toBe(true);
		expect(signals).toEqual([STEPS_CHANGED]);
	});
});

describe("show steps", () => {
	it("shows actuality's steps whose method, pattern or description contains the text a feature line gives", async () => {
		const feature = { path: "/features/test.feature", content: 'show steps matching "testsTEPS-passes" as "definition"' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const discovery = (result.world.runtime.stepResults as TStepResult[])
			.map((stepResult) => stepResult.products as TStepDefinitions | undefined)
			.find((products) => products?.steppers !== undefined);
		if (!discovery) throw new Error("Expected a read of the steps");
		expect(discovery.steps.map((step) => step.method)).toEqual(["TestSteps-passes"]);
		expect(itemAt(discovery.steps, 0)._links.call).toEqual({ method: "TestSteps-passes" });
		expect(discovery.steppers.map((entry) => entry.stepper)).toEqual(["TestSteps"]);
	});

	it("shows the steps a principal holds to a caller that acts for that principal and holds less", async () => {
		const shown: string[][] = [];
		class ActsForAnother extends AStepper {
			description = "Lists steps as a caller holding only a public read that acts for one holding every action.";
			steps = {
				actsForAnother: {
					gwta: "list steps for another",
					action: async () => {
						const haibun = this.getWorld().runtime.steppers?.find((stepper) => stepper instanceof Haibun) as Haibun;
						const list = async () => readShownSteps((await haibun.steps.showSteps.action({ text: "TestSteps-passes", detail: STEP_DETAIL.summary })).products, STEP_DETAIL.summary);
						for (const listed of [await runAuthorizedWith(["Read:public"], list), await runShowing(RUN_AUTHORITY, () => runAuthorizedWith(["Read:public"], list))])
							shown.push(listed.steps.map((step) => step.method));
						return actionOK();
					},
				},
			};
		}
		const result = await passWithDefaults([{ path: "/features/test.feature", content: "list steps for another" }], [Haibun, TestSteps, ActsForAnother]);
		expect(result.ok).toBe(true);
		expect(shown).toEqual([[], ["TestSteps-passes"]]);
	});

	it("states whether a line resolves to one step, and which", async () => {
		const feature = { path: "/features/test.feature", content: 'validate step "passes"\nvalidate step "no step reads this"' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
		const validations = (result.world.runtime.stepResults as TStepResult[]).map((stepResult) => stepResult.products).filter((products) => products?.valid !== undefined);
		expect(validations[0]).toMatchObject({ valid: true, method: "TestSteps-passes" });
		expect(validations[1]).toMatchObject({ valid: false });
	});

	it("treats a line naming a step its caller doesn't hold as one that doesn't name a step, so validating doesn't map a step it may not call", () => {
		const steppers = [new TestSteps()];
		expect(validateStep("passes", steppers, RUN_AUTHORITY)).toMatchObject({ valid: true });
		expect(validateStep("passes", steppers, ["Read:public"]), "a step it doesn't hold").toEqual({ valid: false, error: '"passes" doesn\'t match a step' });
		expect(validateStep("no step reads this", steppers, ["Read:public"]), "treated as a line that doesn't name a step").toEqual({
			valid: false,
			error: '"no step reads this" doesn\'t match a step',
		});
	});
});

describe("nothing", () => {
	it("an empty line passes without acting", async () => {
		const feature = { path: "/features/test.feature", content: "" };
		const result = await passWithDefaults([feature], [Haibun, TestSteps]);
		expect(result.ok).toBe(true);
	});
});

describe("ends with", () => {
	it("ends with ok", async () => {
		const feature = { path: "/features/test.feature", content: 'ends with "OK"\nIs not reached.' };
		const result = await passWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(true);
		expect(result.featureResults?.length).toBe(1);
	});

	it("ends with not ok", async () => {
		const feature = { path: "/features/test.feature", content: 'ends with "not OK"\nIs not reached.' };
		const result = await failWithDefaults([feature], [Haibun]);
		expect(result.ok).toBe(false);
		expect(result.featureResults?.length).toBe(1);
	});
});

describe("backgrounds", () => {
	it("where with Backgrounds shows condition, directive, background steps, then parent", async () => {
		const feature = { path: "/features/test.feature", content: "where passes, Backgrounds: bg" };
		const background = { path: "/backgrounds/bg.feature", content: 'set ran to "true"\nends with "OK"' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
		const seqs = itemAt(result.featureResults, 0).stepResults.map((r) => r.seqPath);
		// The condition [0,1,0,1,1], the background's steps [0,1,0,1,2] and [0,1,0,1,3], and the line [0,1,0,1]
		expect(seqs).toEqual([
			[0, 1, 0, 1, 1],
			[0, 1, 0, 1, 2],
			[0, 1, 0, 1, 3],
			[0, 1, 0, 1],
		]);
	});

	it("not with Backgrounds fails", async () => {
		const feature = { path: "/features/test.feature", content: "not Backgrounds: bg" };
		const background = { path: "/backgrounds/bg.feature", content: "fails" };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);
	});

	it("not with Backgrounds passes", async () => {
		const feature = { path: "/features/test.feature", content: "not Backgrounds: bg" };
		const background = { path: "/backgrounds/bg.feature", content: "passes" };
		const result = await failWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(false);
	});

	it("simple Backgrounds fails during Expand", async () => {
		const feature = { path: "/features/test.feature", content: "Backgrounds: missing" };
		const result = await failWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe("Expand");
		expect(result.failure?.error.message).toMatch(/can't find single "missing.feature"/);
	});

	it("not invalid Backgrounds fails during Resolve", async () => {
		const feature = { path: "/features/test.feature", content: "not Backgrounds: nowhere" };
		const result = await failWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, []);
		expect(result.ok).toBe(false);
		expect(result.failure?.stage).toBe("Resolve");
		expect(result.failure?.error.message).toMatch(/can't find single "nowhere.feature"/);
	});

	it("background steps have correct file path", async () => {
		const feature = { path: "/features/test.feature", content: 'set ran to "false"\nwhere variable "ran" is "false", Backgrounds: bg' };
		const background = { path: "/backgrounds/bg.feature", content: 'set ran to "true"\nends with "OK"' };
		const result = await passWithDefaults([feature], [Haibun, TestSteps, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);

		const paths = itemAt(result.featureResults, 0).stepResults.map((r) => r.path);
		expect(paths).toEqual([
			"test_base/features/test.feature", // set ran
			"test_base/features/test.feature", // condition
			"test_base/backgrounds/bg.feature", // background step
			"test_base/backgrounds/bg.feature", // background step
			"test_base/features/test.feature", // parent where
		]);
	});

	it("feature steps have correct lineNumber", async () => {
		const feature = { path: "/features/test.feature", content: 'set x to "1"\nset y to "2"\nset z to "3"' };
		const result = await passWithDefaults([feature], [VariablesSteppers]);
		expect(result.ok).toBe(true);

		const lineNumbers = itemAt(result.featureResults, 0).stepResults.map((r) => r.lineNumber);
		expect(lineNumbers).toEqual([1, 2, 3]);
	});

	it("background steps have correct lineNumber from background file", async () => {
		const feature = { path: "/features/test.feature", content: "Backgrounds: bg" };
		const background = { path: "/backgrounds/bg.feature", content: 'set ran to "true"\nset more to "value"' };
		const result = await passWithDefaults([feature], [Haibun, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);

		const bgSteps = itemAt(result.featureResults, 0).stepResults.filter((r) => r.path?.includes("backgrounds/")) || [];
		expect(bgSteps.length).toBe(2);

		const bgLineNumbers = bgSteps.map((r) => r.lineNumber);
		expect(bgLineNumbers).toEqual([1, 2]);
	});

	it("activity block steps have correct lineNumber and folder path", async () => {
		const background = { path: "/backgrounds/bg.feature", content: 'Activity: Test Activity\n    set x to "1"\n    waypoint Test Activity with variable x is "1"' };
		const feature = { path: "/features/test.feature", content: "Backgrounds: bg\nScenario: Run Activity\n    ensure Test Activity" };

		const result = await passWithDefaults([feature], [Haibun, ActivitiesStepper, VariablesSteppers], DEF_PROTO_OPTIONS, [background]);
		expect(result.ok).toBe(true);

		const activityStep = itemAt(result.featureResults, 0).stepResults.find((r) => r.in === 'set x to "1"');
		expect(activityStep).toBeDefined();
		expect(activityStep?.lineNumber, "an activity's line states its own line").toBe(2);
		expect(activityStep?.path).toBe("test_base/backgrounds/bg.feature");

		// The waypoint record also carries its source location.
		const waypointStep = itemAt(result.featureResults, 0).stepResults.find((r) => r.in === "Test Activity");
		expect(waypointStep).toBeDefined();
		expect(waypointStep?.lineNumber).toBe(3);
		expect(waypointStep?.path).toBe("test_base/backgrounds/bg.feature");
	});
});
