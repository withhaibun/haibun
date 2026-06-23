import { describe, it, expect } from "vitest";
import { mergeRanges, subtractRanges, intersectRanges, rangeContains, type Range } from "./ranges.js";

const r = (from: number, to: number): Range => ({ from, to });

describe("mergeRanges", () => {
	it("collapses overlapping and touching ranges, sorts, drops empties", () => {
		expect(mergeRanges([r(5, 10), r(1, 5), r(20, 25), r(8, 12), r(30, 30)])).toEqual([r(1, 12), r(20, 25)]);
	});
	it("keeps disjoint ranges separate", () => {
		expect(mergeRanges([r(1, 3), r(5, 8)])).toEqual([r(1, 3), r(5, 8)]);
	});
	it("returns [] for empty input", () => {
		expect(mergeRanges([])).toEqual([]);
	});
});

describe("subtractRanges", () => {
	it("punches a hole in the middle → two pieces (a gap)", () => {
		expect(subtractRanges([r(1, 10)], [r(3, 7)])).toEqual([r(1, 3), r(7, 10)]);
	});
	it("trims a partial overlap", () => {
		expect(subtractRanges([r(1, 10)], [r(7, 20)])).toEqual([r(1, 7)]);
	});
	it("removes a fully-contained range → empty", () => {
		expect(subtractRanges([r(3, 7)], [r(1, 10)])).toEqual([]);
	});
	it("returns the held range when nothing is subtracted (an orphan)", () => {
		expect(subtractRanges([r(1, 10)], [])).toEqual([r(1, 10)]);
	});
	it("handles the open live edge", () => {
		expect(subtractRanges([r(0, Infinity)], [r(0, 100)])).toEqual([r(100, Infinity)]);
	});
});

describe("intersectRanges", () => {
	it("returns the overlap", () => {
		expect(intersectRanges([r(1, 10)], [r(5, 20)])).toEqual([r(5, 10)]);
	});
	it("is empty when disjoint", () => {
		expect(intersectRanges([r(1, 3)], [r(5, 8)])).toEqual([]);
	});
});

describe("rangeContains", () => {
	it("is true inside, false on the upper bound, true on the live edge", () => {
		expect(rangeContains([r(1, 5)], 3)).toBe(true);
		expect(rangeContains([r(1, 5)], 5)).toBe(false);
		expect(rangeContains([r(0, Infinity)], 1e15)).toBe(true);
	});
});
