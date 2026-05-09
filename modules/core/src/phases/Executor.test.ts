import { describe, expect, it } from "vitest";

import { TSeqPath } from "../schema/protocol.js";
import { advanceSyntheticSeqPath, featureSyntheticSeqPath, incSeqPath, calculateShouldClose, syntheticBranchSeqPath, syntheticSeqPathDirection } from "./Executor.js";

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

describe("incSeqPath", () => {
	it("increments single depth seqPath", () => {
		const original: TSeqPath = [1];
		const withSeqPath = [{ seqPath: [1] }, { seqPath: [2] }];
		const incremented = incSeqPath(withSeqPath, original);
		expect(incremented).toEqual([3]);
	});
	it("increments multiple depth seqPath", () => {
		const original: TSeqPath = [1, 2, 3];
		const withSeqPath = [{ seqPath: [1, 2, 3] }];
		const incremented = incSeqPath(withSeqPath, original);
		expect(incremented).toEqual([1, 2, 4]);
	});
});

describe("decSeqPath", () => {
	it("decrements single depth seqPath", () => {
		const original: TSeqPath = [1];
		const withSeqPath = [{ seqPath: [1] }, { seqPath: [2] }];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([-1]);
	});
	it("decrements single depth seqPath", () => {
		const original: TSeqPath = [1];
		const withSeqPath = [{ seqPath: [-1] }, { seqPath: [2] }];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([-2]);
	});
	it("decrements multiple depth seqPath", () => {
		const original: TSeqPath = [1, 2, 3];
		const withSeqPath = [{ seqPath: [1, 2, 3] }];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([1, 2, -1]);
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
			// This is "effectively last" because we're stopping due to failure
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: false, continueAfterError: false });
			expect(result).toBe(true); // close by default
		});

		it("stays open on failed last feature when stayOnFailure is true", () => {
			const result = calculateShouldClose({ ...defaults, thisFeatureOK: false, isLast: true, stayOnFailure: true });
			expect(result).toBe(false); // stay open for debugging
		});

		it("stays open on failed non-last feature when stayOnFailure is true and NOT continuing", () => {
			// "Effectively last" because we're stopping due to failure
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
