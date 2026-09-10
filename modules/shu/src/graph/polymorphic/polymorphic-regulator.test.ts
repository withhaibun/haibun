// The scene regulates its own decorative motion the way the run's health monitor regulates the run: a rolling window,
// a threshold, a signal under cooldown. These cases hold the arithmetic and the discipline.
import { describe, expect, it } from "vitest";
import {
	DEFAULT_REGULATION_THRESHOLDS,
	describeRegulation,
	evaluateRegulation,
	medianOf,
	newRegulationState,
	recordFrameCost,
	type TRegulationThresholds,
} from "./polymorphic-regulator.js";

const thresholds: TRegulationThresholds = { windowSamples: 5, decorativeBudgetShare: 0.05, beatsPerSecond: 10, cooldownMs: 10_000 };

function fed(costs: number[]) {
	const state = newRegulationState();
	for (const c of costs) recordFrameCost(state, c, thresholds.windowSamples);
	return state;
}

describe("the frame-cost window", () => {
	it("keeps the last window of samples and takes their median, so one anomaly decides nothing", () => {
		const state = fed([1, 1, 90, 1, 1, 1, 1]);
		expect(state.frameCosts, "the window holds the newest five").toEqual([90, 1, 1, 1, 1]);
		expect(medianOf(state.frameCosts)).toBe(1);
		expect(medianOf([2, 40, 3]), "an anomaly among three").toBe(3);
	});

	it("decides nothing before the window is full", () => {
		const state = fed([50, 50, 50]);
		expect(evaluateRegulation(state, thresholds, 0)).toBeUndefined();
		expect(state.resting).toBe(false);
	});
});

describe("the breath's budget", () => {
	it("rests the breath when its share of wall time exceeds the budget, once, and holds through the cooldown", () => {
		const state = fed([16, 17, 16, 25, 16]); // a software rasterizer: 16 ms a frame at ten beats a second is 16%
		const signal = evaluateRegulation(state, thresholds, 1_000);
		expect(signal).toEqual({ kind: "decorativeOverBudget", frameCostMs: 16, share: 0.16 });
		expect(state.resting).toBe(true);
		recordFrameCost(state, 16, thresholds.windowSamples);
		expect(evaluateRegulation(state, thresholds, 5_000), "still over, already resting: no new signal").toBeUndefined();
		expect(describeRegulation(signal as NonNullable<typeof signal>)).toBe("the breath rests: it would take 16% of wall time at 16.0 ms a frame");
	});

	it("lets a cheap frame breathe: within budget nothing fires and the breath runs", () => {
		const state = fed([1.5, 1.8, 1.4, 2.1, 1.6]); // a GPU: under 2 ms a frame is under 2%
		expect(evaluateRegulation(state, thresholds, 1_000)).toBeUndefined();
		expect(state.resting).toBe(false);
	});

	it("resumes the breath when the cost falls within budget after the cooldown, and not before", () => {
		const state = fed([16, 16, 16, 16, 16]);
		evaluateRegulation(state, thresholds, 1_000);
		for (const c of [2, 2, 2, 2, 2]) recordFrameCost(state, c, thresholds.windowSamples);
		expect(evaluateRegulation(state, thresholds, 5_000), "within the cooldown: no flap").toBeUndefined();
		expect(state.resting).toBe(true);
		const signal = evaluateRegulation(state, thresholds, 11_001);
		expect(signal).toEqual({ kind: "decorativeWithinBudget", frameCostMs: 2, share: 0.02 });
		expect(state.resting).toBe(false);
		expect(describeRegulation(signal as NonNullable<typeof signal>)).toBe("the breath resumes: it takes 2% of wall time at 2.0 ms a frame");
	});

	it("defaults: five samples, a twentieth of wall time, ten beats a second from the breath's own cadence", () => {
		expect(DEFAULT_REGULATION_THRESHOLDS).toEqual({ windowSamples: 5, decorativeBudgetShare: 0.05, beatsPerSecond: 10, cooldownMs: 10_000 });
	});
});
