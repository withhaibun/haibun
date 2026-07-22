import { describe, it, expect } from "vitest";
import { visibleWindow, shouldFollow } from "./virtual-column-model.js";

describe("visibleWindow", () => {
	it("derives {first, visible} from first/last visible indices", () => {
		expect(visibleWindow(10, 19)).toEqual({ first: 10, visible: 10 });
		expect(visibleWindow(0, 0)).toEqual({ first: 0, visible: 1 });
	});
	it("clamps an inverted/empty viewport to zero visible", () => {
		expect(visibleWindow(5, 4)).toEqual({ first: 5, visible: 0 });
	});
});

describe("shouldFollow", () => {
	const atEnd = { first: 90, visible: 10 }; // covers up to index 99
	it("sticks when following, at the end, and at the live time edge", () => {
		expect(shouldFollow(true, atEnd, 100, null)).toBe(true);
		expect(shouldFollow(true, { first: 90, visible: 10 }, 100, null)).toBe(true);
	});
	it("does not stick when the reader has scrolled up (window short of the pre-append count)", () => {
		expect(shouldFollow(true, { first: 0, visible: 10 }, 100, null)).toBe(false);
	});
	it("does not stick when scrubbed into the past (a cursor is set)", () => {
		expect(shouldFollow(true, atEnd, 100, 12345)).toBe(false);
	});
	it("does not stick when following is off", () => {
		expect(shouldFollow(false, atEnd, 100, null)).toBe(false);
	});
	it("the boundary is the pre-append count: a window whose end touches it still counts as at-end", () => {
		expect(shouldFollow(true, { first: 95, visible: 5 }, 100, null)).toBe(true); // 95+5 === 100
		expect(shouldFollow(true, { first: 95, visible: 4 }, 100, null)).toBe(false); // 95+4 < 100
	});
});
