import { describe, expect, it } from "vitest";

import { nextSeqPath } from "./step-dispatch.js";
import { foldStep } from "../derivations/step-results.js";
import { STAY_ALWAYS, STAY_FAILURE, type TFeatureResult, type TFeatureSteps, type TStepResult } from "../../domains/protocol.js";
import { calculateShouldClose, executionFailure, staysAfterExecution } from "../derivations/execution-end.js";
import { advanceSyntheticSeqPath, syntheticBranchSeqPath, syntheticSeqPathDirection } from "../domains/seq-path.js";
import { passWithDefaults, failWithDefaults } from "../../test/lib.js";
import { scenarioEventId } from "../derivations/lifecycle-events.js";
import { readEvery } from "../../records/pipelines/record-reads.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD } from "../domains/seq-path.js";
import { RECORDED_STATUS, TEST_BASE } from "../../domains/protocol.js";
import { AStepper } from "../../steps/domains/stepper.js";
import { actionNotOK, actionOK } from "../../domains/util.js";
import { DOMAIN_TEXT } from "../../domains/domains.js";
import { itemAt } from "../../domains/item-at.js";

describe("syntheticSeqPathDirection", () => {
	it("uses positive direction for authoritative branches", () => {
		expect(syntheticSeqPathDirection(false)).toBe(1);
	});

	it("uses negative direction for speculative branches", () => {
		expect(syntheticSeqPathDirection(true)).toBe(-1);
	});
});

describe("syntheticBranchSeqPath", () => {
	it("creates an authoritative branch under a parent step", () => {
		expect(syntheticBranchSeqPath([1, 1, 2], 1)).toEqual([1, 1, 2, 1]);
	});

	it("creates a speculative branch under a parent step", () => {
		expect(syntheticBranchSeqPath([1, 1, 2], -1)).toEqual([1, 1, 2, -1]);
	});
});

describe("advanceSyntheticSeqPath", () => {
	it("advances an authoritative synthetic branch", () => {
		expect(advanceSyntheticSeqPath([1, 1, 2, 1], 1)).toEqual([1, 1, 2, 2]);
	});

	it("advances a speculative synthetic branch", () => {
		expect(advanceSyntheticSeqPath([1, 1, 2, -1], -1)).toEqual([1, 1, 2, -2]);
	});
});

describe("the path allocated under a parent step", () => {
	const aWorld = () => ({ runtime: { seqPaths: new Map<string, number>() } }) as unknown as Parameters<typeof nextSeqPath>[0];

	it("starts at one under a parent and advances by one for each allocation", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1, 2], 1)).toEqual([1, 2, 1]);
		expect(nextSeqPath(world, [1, 2], 1)).toEqual([1, 2, 2]);
		expect(nextSeqPath(world, [1, 2], 1)).toEqual([1, 2, 3]);
	});

	it("counts each parent separately", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1], 1)).toEqual([1, 1]);
		expect(nextSeqPath(world, [2], 1)).toEqual([2, 1]);
		expect(nextSeqPath(world, [1], 1)).toEqual([1, 2]);
	});

	it("counts a speculative substep in the negative direction", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1, 2], -1)).toEqual([1, 2, -1]);
		expect(nextSeqPath(world, [1, 2], -1)).toEqual([1, 2, -2]);
	});

	it("counts each direction under one parent separately", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [3], 1)).toEqual([3, 1]);
		expect(nextSeqPath(world, [3], -1)).toEqual([3, -1]);
		expect(nextSeqPath(world, [3], 1)).toEqual([3, 2]);
	});

	it("takes constant time however many steps the feature has executed, because it counts instead of searching", () => {
		const world = aWorld();
		for (let i = 0; i < 20000; i++) nextSeqPath(world, [1, i % 50], 1);
		const began = performance.now();
		for (let i = 0; i < 1000; i++) nextSeqPath(world, [1, i % 50], 1);
		expect(performance.now() - began, "a thousand allocations after twenty thousand allocations").toBeLessThan(50);
	});
});

describe("staysAfterExecution", () => {
	it("stays under STAY_ALWAYS, and under STAY_FAILURE only after a failure", () => {
		expect([
			staysAfterExecution(STAY_ALWAYS, true),
			staysAfterExecution(STAY_ALWAYS, false),
			staysAfterExecution(STAY_FAILURE, false),
			staysAfterExecution(STAY_FAILURE, true),
			staysAfterExecution(undefined, false),
		]).toEqual([true, true, true, false, false]);
	});
});

describe("calculateShouldClose", () => {
	// The defaults describe a passing feature that isn't last, without continueAfterError or stay.
	const defaults = { thisFeatureOK: true, isLast: false, continueAfterError: false, stay: undefined };

	describe("a feature that isn't last (more features follow)", () => {
		it("closes after a passing feature", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: false });
			expect(result).toBe(true);
		});

		it("closes after a failed feature when continueAfterError is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: true });
			expect(result).toBe(true);
		});
	});

	describe("an effectively last feature (a later feature doesn't execute)", () => {
		it("closes after a passing last feature by default", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: true });
			expect(result).toBe(true);
		});

		it("closes after a failed feature that isn't last when continueAfterError is false", () => {
			// Execution stops on the failure, so the feature is effectively last.
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: false });
			expect(result).toBe(true);
		});

		it("stays open on a failed last feature when actuality stays on failure", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: true, stay: STAY_FAILURE });
			expect(result).toBe(false); // stays open for debugging
		});

		it("stays open on a failed feature that isn't last when actuality stays on failure and continueAfterError is false", () => {
			// Execution stops on the failure, so the feature is effectively last.
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: false, stay: STAY_FAILURE });
			expect(result).toBe(false); // stays open for debugging
		});
	});

	describe("staying always", () => {
		it("stays open on a passing last feature when actuality always stays", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: true, stay: STAY_ALWAYS });
			expect(result).toBe(false);
		});

		it("stays open on a failed last feature when actuality always stays", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: true, stay: STAY_ALWAYS });
			expect(result).toBe(false);
		});

		it("closes a feature that isn't last when actuality always stays", () => {
			// Staying applies only to an effectively last feature.
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: false, stay: STAY_ALWAYS });
			expect(result).toBe(true);
		});
	});
});

describe("executionFailure", () => {
	const step = (seqPath: number[], ok: boolean, errorMessage?: string) => ({ ok, errorMessage, in: `step ${seqPath.join(".")}`, seqPath }) as unknown as TStepResult;
	// The helper reduces each step result with foldStep. dispatchStep calls foldStep in actuality.
	const feature = (stepResults: TStepResult[]) => {
		const steps: TFeatureSteps = { count: 0 };
		for (const result of stepResults) foldStep(steps, result);
		return [{ path: "/features/test.feature", ok: false, steps, stepResults }] as unknown as TFeatureResult[];
	};

	it("names the failed feature step instead of an earlier failed synthetic dispatch", () => {
		// A synthetic dispatch carries a negative seqPath segment. A model's tool call and an RPC dispatch are synthetic
		// dispatches. The step that made the dispatch can handle its failure. A handled failure doesn't fail actuality.
		const failure = executionFailure(feature([step([0, -1, 1], false, "tool call failed"), step([0, 2, 4], false, "the real failure")]));
		expect(failure?.error.message).toBe("the real failure");
		expect(failure?.error.details.seqPath).toEqual([0, 2, 4]);
	});

	it("names a failed synthetic dispatch when a feature step didn't fail, so actuality still reports a failure", () => {
		const failure = executionFailure(feature([step([0, -1, 1], false, "only this failed")]));
		expect(failure?.error.message).toBe("only this failed");
	});
});

describe("the hash of a feature's declared step text", () => {
	class NotingStepper extends AStepper {
		description = "Notes a text, and refuses.";
		steps = {
			note: { gwta: `note {what: ${DOMAIN_TEXT}}`, action: () => Promise.resolve(actionOK()) },
			refuse: { gwta: "refuse here", action: () => Promise.resolve(actionNotOK("refused")) },
		};
	}
	const hashOf = async (content: string): Promise<string> =>
		itemAt((await passWithDefaults([{ path: "/features/noted.feature", content }], [NotingStepper])).featureResults, 0).declaredStepTextHash;

	it("is the same for two runs of the same declared steps, and differs when a step's text changes or a step is added", async () => {
		const twice = await hashOf("note one\nnote two");
		expect(twice).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashOf("note one\nnote two")).toBe(twice);
		expect(await hashOf("note one\nnote three")).not.toBe(twice);
		expect(await hashOf("note one\nnote two\nnote three")).not.toBe(twice);
	});

	it("covers the steps a feature declares after a failed step, though they don't execute", async () => {
		const hashAfterRefusal = async (last: string) =>
			itemAt((await failWithDefaults([{ path: "/features/refused.feature", content: `note one\nrefuse here\n${last}` }], [NotingStepper])).featureResults, 0).declaredStepTextHash;
		expect(await hashAfterRefusal("note three")).not.toBe(await hashAfterRefusal("note four"));
	});
});

describe("the actuality the Executor moves", () => {
	class SceneStepper extends AStepper {
		description = "Starts a feature or a scenario, notes a text, and refuses.";
		steps = {
			feature: { gwta: `Feature: {what: ${DOMAIN_TEXT}}`, action: () => Promise.resolve(actionOK()) },
			scenario: { gwta: `Scenario: {what: ${DOMAIN_TEXT}}`, action: () => Promise.resolve(actionOK()) },
			note: { gwta: `note {what: ${DOMAIN_TEXT}}`, action: () => Promise.resolve(actionOK()) },
			refuse: { gwta: "refuse here", action: () => Promise.resolve(actionNotOK("refused")) },
		};
	}

	it("starts and ends each level, and numbers each scenario once in its events and its steps' paths, a second feature heading starting the next", async () => {
		const a = 'note "before"\nFeature: "first"\nnote "background"\nScenario: "a"\nnote "in a"\nScenario: "b"\nnote "in b"\nFeature: "second"\nnote "in second"';
		const result = await failWithDefaults(
			[
				{ path: "/features/a.feature", content: a },
				{ path: "/features/b.feature", content: 'note "one"\nrefuse here' },
			],
			[SceneStepper],
		);
		const { actuality } = result;
		expect(actuality.status).toBe("failed");
		expect(actuality.open.size, "every step that started has ended").toBe(0);
		expect(actuality.features.map((f) => [f.id, f.status, f.steps, f.failed])).toEqual([
			// A heading is a level of its own, so its line counts as a scenario and not as a step.
			["feat-1", "completed", 5, 0],
			["feat-2", "failed", 2, 1],
		]);
		expect(itemAt(result.featureResults, 0).stepResults.map((r) => [r.in, r.seqPath.slice(2).join(".")])).toEqual([
			['note "before"', "0.1"],
			['note "background"', "0.3"],
			['note "in a"', "1.1"],
			['note "in b"', "2.1"],
			['note "in second"', "3.3"],
		]);
		expect(actuality.features[0]?.scenarios.map((s) => [s.id, s.name, s.status])).toEqual([
			[scenarioEventId(1, 1), '"a"', "completed"],
			[scenarioEventId(1, 2), '"b"', "completed"],
			[scenarioEventId(1, 3), '"second"', "completed"],
		]);
		expect(actuality.features[1]?.firstFailure).toMatchObject({ step: "refuse here", message: "refused" });
		const records = await readEvery(result.world.shared.getStore(), { label: SEQ_PATH_LABEL, sortBy: SEQ_PATH_FIELD.generatedAtTime, sortOrder: "asc" });
		const ids = new Set(records.map((record) => record[SEQ_PATH_FIELD.id]));
		expect(
			records.filter((record) => record[SEQ_PATH_EDGE.isPartOf] !== undefined && !ids.has(record[SEQ_PATH_EDGE.isPartOf])),
			"every isPartOf names a record",
		).toEqual([]);
		const levels = records.filter((record) => record[SEQ_PATH_FIELD.actualityLevel] !== "step");
		const key = result.world.tag.key;
		expect(
			levels.map((record) => [
				record[SEQ_PATH_FIELD.id],
				record[SEQ_PATH_FIELD.actualityLevel],
				record[SEQ_PATH_FIELD.stepText],
				record[SEQ_PATH_FIELD.actionStatus],
				record[SEQ_PATH_EDGE.isPartOf],
			]),
		).toEqual([
			[`${key}-0`, "execution", TEST_BASE, RECORDED_STATUS.failed, undefined],
			[`${key}-1.0.1.0`, "feature", "/features/a", RECORDED_STATUS.completed, `${key}-0`],
			[`${key}-1.0.1.1`, "scenario", '"a"', RECORDED_STATUS.completed, `${key}-1.0.1.0`],
			[`${key}-1.0.1.2`, "scenario", '"b"', RECORDED_STATUS.completed, `${key}-1.0.1.0`],
			[`${key}-1.0.1.3`, "scenario", '"second"', RECORDED_STATUS.completed, `${key}-1.0.1.0`],
			[`${key}-2.0.2.0`, "feature", "/features/b", RECORDED_STATUS.failed, `${key}-0`],
		]);
		expect(levels.at(-1)?.[SEQ_PATH_FIELD.error], "a feature's record states its first failure").toMatch(/refuse here \(refused\)$/);
	});
});
