// The scene regulates its own decorative motion the way the run's health monitor regulates the run: a rolling window,
// a threshold, a signal under cooldown. These cases hold the arithmetic and the discipline.
import { describe, expect, it } from "vitest";
import {
	DEFAULT_REGULATION_THRESHOLDS,
	describeRegulation,
	evaluateRegulation,
	medianOf,
	newRegulationState,
	recordFrameTime,
	type TRegulationThresholds,
} from "./polymorphic-regulator.js";

const thresholds: TRegulationThresholds = { windowSamples: 5, decorativeShareLimit: 0.05, beatsPerSecond: 10, cooldownMs: 10_000 };

function fed(takes: number[]) {
	const state = newRegulationState();
	for (const c of takes) recordFrameTime(state, c, thresholds.windowSamples);
	return state;
}

describe("the frame-time window", () => {
	it("keeps the last window of samples and takes their median, so one anomaly changes nothing", () => {
		const state = fed([1, 1, 90, 1, 1, 1, 1]);
		expect(state.frameTimes, "the window holds the newest five").toEqual([90, 1, 1, 1, 1]);
		expect(medianOf(state.frameTimes)).toBe(1);
		expect(medianOf([2, 40, 3]), "an anomaly among three").toBe(3);
	});

	it("compares nothing before the window is full, and decoration rests until it has been measured", () => {
		const state = fed([1, 1, 1]);
		expect(evaluateRegulation(state, thresholds, 0)).toBeUndefined();
		expect(state.resting).toBe(true);
	});
});

describe("the breath's limit", () => {
	it("keeps decoration at rest on a frame that would take it past its limit: it never starts, and nothing fires", () => {
		const state = fed([16, 17, 16, 25, 16]); // a software rasterizer: 16 ms a frame at ten beats a second is 16%
		expect(evaluateRegulation(state, thresholds, 1_000)).toBeUndefined();
		expect(state.resting).toBe(true);
	});

	it("starts decoration on a fast frame: the first full window within its limit lets the breath run", () => {
		const state = fed([1.5, 1.8, 1.4, 2.1, 1.6]); // a GPU: under 2 ms a frame is under 2%
		const signal = evaluateRegulation(state, thresholds, 1_000);
		expect(signal).toEqual({ kind: "decorativeWithinLimit", frameTimeMs: 1.6, share: 0.016 });
		expect(state.resting).toBe(false);
		expect(describeRegulation(signal as NonNullable<typeof signal>)).toBe("the breath resumes: it takes 2% of wall time at 1.6 ms a frame");
	});

	it("rests running decoration when its share exceeds the limit after the cooldown, once, and not before", () => {
		const state = fed([2, 2, 2, 2, 2]);
		evaluateRegulation(state, thresholds, 1_000);
		for (const c of [16, 17, 16, 25, 16]) recordFrameTime(state, c, thresholds.windowSamples);
		expect(evaluateRegulation(state, thresholds, 5_000), "within the cooldown: no flap").toBeUndefined();
		expect(state.resting).toBe(false);
		const signal = evaluateRegulation(state, thresholds, 11_001);
		expect(signal).toEqual({ kind: "decorativeOverLimit", frameTimeMs: 16, share: 0.16 });
		expect(state.resting).toBe(true);
		recordFrameTime(state, 16, thresholds.windowSamples);
		expect(evaluateRegulation(state, thresholds, 30_000), "still over, already resting: no new signal").toBeUndefined();
		expect(describeRegulation(signal as NonNullable<typeof signal>)).toBe("the breath rests: it would take 16% of wall time at 16.0 ms a frame");
	});

	it("defaults: five samples, a twentieth of wall time, ten beats a second from the breath's own cadence", () => {
		expect(DEFAULT_REGULATION_THRESHOLDS).toEqual({ windowSamples: 5, decorativeShareLimit: 0.05, beatsPerSecond: 10, cooldownMs: 10_000 });
	});
});
