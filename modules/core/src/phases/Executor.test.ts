import { describe, expect, it } from "vitest";

import { foldStep } from "../lib/step-dispatch.js";
import type { TFeatureSteps } from "../schema/protocol.js";
import { Executor, advanceSyntheticSeqPath, featureSyntheticSeqPath, nextSeqPath, calculateShouldClose, syntheticBranchSeqPath, syntheticSeqPathDirection } from "./Executor.js";
import type { TFeatureResult, TStepResult } from "../lib/defs.js";

describe("syntheticSeqPathDirection", () => {
	it("uses positive direction for authoritative branches", () => {
		expect(syntheticSeqPathDirection(false)).toBe(1);
	});

	it("uses negative direction for speculative branches", () => {
		expect(syntheticSeqPathDirection(true)).toBe(-1);
	});
});

describe("featureSyntheticSeqPath", () => {
	it("creates a feature-scoped synthetic branch rooted on hostId 0 by default", () => {
		expect(featureSyntheticSeqPath(3, 2)).toEqual([0, 3, 0, 2]);
	});

	it("allows a non-default synthetic branch when needed", () => {
		expect(featureSyntheticSeqPath(3, 2, -1)).toEqual([0, 3, -1, 2]);
	});

	it("accepts an explicit hostId so multi-host synthetics cannot collide", () => {
		expect(featureSyntheticSeqPath(3, 2, 0, 7)).toEqual([7, 3, 0, 2]);
	});
});

describe("syntheticBranchSeqPath", () => {
	it("creates an authoritative branch under a parent step", () => {
		expect(syntheticBranchSeqPath([1, 1, 2])).toEqual([1, 1, 2, 1]);
	});

	it("creates a speculative branch under a parent step", () => {
		expect(syntheticBranchSeqPath([1, 1, 2], -1)).toEqual([1, 1, 2, -1]);
	});
});

describe("advanceSyntheticSeqPath", () => {
	it("advances an authoritative synthetic branch", () => {
		expect(advanceSyntheticSeqPath([1, 1, 2, 1])).toEqual([1, 1, 2, 2]);
	});

	it("advances a speculative synthetic branch", () => {
		expect(advanceSyntheticSeqPath([1, 1, 2, -1], -1)).toEqual([1, 1, 2, -2]);
	});
});

describe("the path allocated under a parent step", () => {
	const aWorld = () => ({ runtime: {} }) as unknown as Parameters<typeof nextSeqPath>[0];

	it("counts from one under a parent, and on from what it last gave", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1, 2])).toEqual([1, 2, 1]);
		expect(nextSeqPath(world, [1, 2])).toEqual([1, 2, 2]);
		expect(nextSeqPath(world, [1, 2])).toEqual([1, 2, 3]);
	});

	it("counts each parent on its own", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1])).toEqual([1, 1]);
		expect(nextSeqPath(world, [2])).toEqual([2, 1]);
		expect(nextSeqPath(world, [1])).toEqual([1, 2]);
	});

	it("counts a synthetic step the other way, so what a step ran is told from what a feature asked for", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [1, 2], -1)).toEqual([1, 2, -1]);
		expect(nextSeqPath(world, [1, 2], -1)).toEqual([1, 2, -2]);
	});

	it("counts the two directions under one parent apart", () => {
		const world = aWorld();
		expect(nextSeqPath(world, [3], 1)).toEqual([3, 1]);
		expect(nextSeqPath(world, [3], -1)).toEqual([3, -1]);
		expect(nextSeqPath(world, [3], 1)).toEqual([3, 2]);
	});

	it("costs the same however many steps the feature has run, since it counts rather than searches", () => {
		const world = aWorld();
		for (let i = 0; i < 20000; i++) nextSeqPath(world, [1, i % 50]);
		const began = performance.now();
		for (let i = 0; i < 1000; i++) nextSeqPath(world, [1, i % 50]);
		expect(performance.now() - began, "a thousand allocations against twenty thousand already made").toBeLessThan(50);
	});
});

describe("calculateShouldClose", () => {
	// Default test values - feature OK, not last, no special flags
	const defaults = {
		thisFeatureOK: true,
		isLast: false,
		stayOnFailure: false,
		continueAfterError: false,
		stayAlways: false,
	};

	describe("non-last feature (more features to run)", () => {
		it("closes after successful feature to start fresh for next", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: false });
			expect(result).toBe(true); // close
		});

		it("closes after failed feature when continueAfterError is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: true });
			expect(result).toBe(true); // close - more features to run
		});
	});

	describe("effectively last feature (no more features will run)", () => {
		it("closes after successful last feature by default", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: true });
			expect(result).toBe(true); // close
		});

		it("closes after failed non-last feature when NOT continuing after error", () => {
			// "Effectively last": execution stops on failure
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: false });
			expect(result).toBe(true); // close by default
		});

		it("stays open on failed last feature when stayOnFailure is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: true, stayOnFailure: true });
			expect(result).toBe(false); // stay open for debugging
		});

		it("stays open on failed non-last feature when stayOnFailure is true and NOT continuing", () => {
			// "Effectively last": execution stops on failure
			const result = calculateShouldClose({
				...defaults,
				thisFeatureOK: false,
				isLast: false,
				continueAfterError: false,
				stayOnFailure: true,
			});
			expect(result).toBe(false); // stay open for debugging
		});
	});

	describe("stayAlways flag", () => {
		it("stays open on last successful feature when stayAlways is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: true, stayAlways: true });
			expect(result).toBe(false); // stay open
		});

		it("stays open on last failed feature when stayAlways is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: true, stayAlways: true });
			expect(result).toBe(false); // stay open
		});

		it("closes non-last feature even when stayAlways is true", () => {
			// stayAlways only applies to "effectively last" features
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: true, isLast: false, stayAlways: true });
			expect(result).toBe(true); // close - more features to run
		});
	});
});

describe("createExecutionFailure", () => {
	const step = (seqPath: number[], ok: boolean, errorMessage?: string) => ({ ok, errorMessage, in: `step ${seqPath.join(".")}`, seqPath }) as unknown as TStepResult;
	// A feature's steps come to a verdict as they run, which is how the run itself arrives at one.
	const feature = (stepResults: TStepResult[]) => {
		const steps: TFeatureSteps = { count: 0 };
		for (const result of stepResults) foldStep(steps, result);
		return [{ path: "/features/test.feature", ok: false, steps, stepResults }] as unknown as TFeatureResult[];
	};

	it("names the feature step that failed, not a synthetic dispatch the step recovered from", () => {
		// A model's tool call and an RPC dispatch carry a negative seqPath segment; either can fail and be handled
		// inside the step that made it, so neither is what failed the run.
		const failure = Executor.createExecutionFailure(feature([step([0, -1, 1], false, "tool call failed"), step([0, 2, 4], false, "the real failure")]));
		expect(failure?.error.message).toBe("the real failure");
		expect(failure?.error.details.seqPath).toEqual([0, 2, 4]);
	});

	it("falls back to a synthetic dispatch when nothing else failed, rather than reporting no failure at all", () => {
		const failure = Executor.createExecutionFailure(feature([step([0, -1, 1], false, "only this failed")]));
		expect(failure?.error.message).toBe("only this failed");
	});
});
