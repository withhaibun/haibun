import { describe, it, expect } from "vitest";
import { buildPiecewiseTimeline, displayToTime, timeToDisplay, DEFAULT_IDLE_SEGMENT_WIDTH } from "./piecewise-timeline.js";

describe("buildPiecewiseTimeline", () => {
	it("returns an empty timeline for no events", () => {
		const tl = buildPiecewiseTimeline([]);
		expect(tl.segments).toEqual([]);
		expect(tl.totalDisplay).toBe(0);
	});

	it("collapses a dense burst into one active segment whose display width equals the wall-clock span", () => {
		const events = [1000, 1500, 2000, 2500, 3000];
		const tl = buildPiecewiseTimeline(events, 1000);
		expect(tl.segments).toHaveLength(1);
		expect(tl.segments[0]).toMatchObject({ kind: "active", startTime: 1000, endTime: 3000 });
		expect(tl.totalDisplay).toBe(2000);
	});

	it("inserts a fixed-width idle gap whenever the interval between events exceeds the threshold", () => {
		// 10s burst, 10-minute idle, 5s burst
		const events = [1_000_000, 1_005_000, 1_010_000, 1_610_000, 1_613_000, 1_615_000];
		const tl = buildPiecewiseTimeline(events, 30_000, 20);
		expect(tl.segments).toHaveLength(3);
		expect(tl.segments[0]).toMatchObject({ kind: "active", startTime: 1_000_000, endTime: 1_010_000 });
		expect(tl.segments[1]).toMatchObject({ kind: "idle", startTime: 1_010_000, endTime: 1_610_000 });
		expect(tl.segments[1].displayEnd - tl.segments[1].displayStart).toBe(20);
		expect(tl.segments[2]).toMatchObject({ kind: "active", startTime: 1_610_000, endTime: 1_615_000 });
		// The 10s burst (display width 10_000) and the 5s burst (display width 5_000) both remain visible;
		// the 10-minute idle gap takes only the idle-segment width.
		expect(tl.totalDisplay).toBe(10_000 + 20 + 5_000);
	});

	it("displayToTime round-trips inside an active segment", () => {
		const tl = buildPiecewiseTimeline([1_000_000, 1_005_000, 1_010_000], 30_000);
		const mid = displayToTime(tl, 5_000);
		expect(mid).toBe(1_005_000);
	});

	it("displayToTime snaps a position inside an idle gap forward to the next event", () => {
		const tl = buildPiecewiseTimeline([1_000_000, 1_010_000, 1_610_000], 30_000, 20);
		// First active segment spans display 0..10_000. Idle segment is 10_000..10_020.
		// Pick a position halfway through the idle gap.
		const t = displayToTime(tl, 10_010);
		expect(t).toBe(1_610_000);
	});

	it("timeToDisplay returns the active-segment offset proportional to the event's position within its burst", () => {
		const tl = buildPiecewiseTimeline([1_000_000, 1_010_000, 1_610_000, 1_615_000], 30_000, 20);
		expect(timeToDisplay(tl, 1_005_000)).toBe(5_000);
		expect(timeToDisplay(tl, 1_612_500)).toBe(10_000 + 20 + 2_500);
	});

	it("clamps out-of-range times to the timeline ends", () => {
		const tl = buildPiecewiseTimeline([1_000_000, 1_005_000], 30_000);
		expect(timeToDisplay(tl, 0)).toBe(0);
		expect(timeToDisplay(tl, 9_999_999_999)).toBe(tl.totalDisplay);
	});

	it("ignores out-of-order input by sorting before building", () => {
		const tl = buildPiecewiseTimeline([3000, 1000, 2000]);
		expect(tl.segments).toHaveLength(1);
		expect(tl.segments[0]).toMatchObject({ startTime: 1000, endTime: 3000 });
	});

	it("uses the default idle segment width when only the threshold is overridden", () => {
		const tl = buildPiecewiseTimeline([1000, 2000, 1_000_000, 1_001_000]);
		expect(tl.segments[1].displayEnd - tl.segments[1].displayStart).toBe(DEFAULT_IDLE_SEGMENT_WIDTH);
	});
});
