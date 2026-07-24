import { describe, it, expect } from "vitest";
import { visibleWindow, convergeTarget, COARSE_GAP, CONVERGE_STEP } from "./virtual-column-model.js";

describe("visibleWindow", () => {
	it("derives {first, visible} from first/last visible indices", () => {
		expect(visibleWindow(10, 19)).toEqual({ first: 10, visible: 10 });
		expect(visibleWindow(0, 0)).toEqual({ first: 0, visible: 1 });
	});
	it("clamps an inverted/empty viewport to zero visible", () => {
		expect(visibleWindow(5, 4)).toEqual({ first: 5, visible: 0 });
	});
});

describe("convergeTarget — the two-gait jump-to-live-edge target", () => {
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
