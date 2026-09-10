import { describe, it, expect } from "vitest";
import { visibleWindow, convergeTarget, COARSE_GAP, CONVERGE_STEP, currentRowIndex, rowTimeClass } from "./virtual-column-model.js";

describe("visibleWindow", () => {
	it("derives {first, visible} from first/last visible indices", () => {
		expect(visibleWindow(10, 19)).toEqual({ first: 10, visible: 10 });
		expect(visibleWindow(0, 0)).toEqual({ first: 0, visible: 1 });
	});
	it("clamps an inverted/empty viewport to zero visible", () => {
		expect(visibleWindow(5, 4)).toEqual({ first: 5, visible: 0 });
	});
});

describe("convergeTarget: the two-gait jump-to-live-edge target", () => {
	it("goes coarse (straight to the last row) while the gap is beyond COARSE_GAP", () => {
		expect(convergeTarget({ first: 0, visible: 20 }, 20 + COARSE_GAP + 1)).toBe(20 + COARSE_GAP);
	});
	it("steps by CONVERGE_STEP once the gap is at or under COARSE_GAP, so each target adjoins measured rows", () => {
		const window = { first: 700, visible: 20 }; // window end 720
		expect(convergeTarget(window, 720 + COARSE_GAP)).toBe(720 + CONVERGE_STEP);
	});
	it("clamps the step to the last row on final approach", () => {
		expect(convergeTarget({ first: 700, visible: 20 }, 725)).toBe(724);
	});
	it("targets the last row when the window already holds it (the stick that keeps the pin at the edge)", () => {
		expect(convergeTarget({ first: 700, visible: 24 }, 724)).toBe(723);
	});
});

describe("the cursor on resident rows", () => {
	const rows = [
		{ index: 3, timestamp: 100 },
		{ index: 4, timestamp: 110 },
		{ index: 9, timestamp: 120 },
	];
	it("the current row is the last resident one at or before the cursor, by index; none without a cursor or before the first", () => {
		expect(currentRowIndex(rows, null)).toBe(-1);
		expect(currentRowIndex(rows, 50)).toBe(-1);
		expect(currentRowIndex(rows, 115)).toBe(4);
		expect(currentRowIndex(rows, 120)).toBe(9);
	});
	it("a row after the cursor is future, the cursor's row current, an earlier one unclassed, and nothing without a cursor", () => {
		const current = currentRowIndex(rows, 115);
		expect(rowTimeClass(120, 9, 115, current)).toBe("future");
		expect(rowTimeClass(110, 4, 115, current)).toBe("current");
		expect(rowTimeClass(100, 3, 115, current)).toBe("");
		expect(rowTimeClass(120, 9, null, -1)).toBe("");
	});
});
