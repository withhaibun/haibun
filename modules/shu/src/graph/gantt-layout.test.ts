import { describe, it, expect } from "vitest";
import { timeToGanttX, ganttBarTimes, ganttAxisTicks, type GanttScale } from "./gantt-layout.js";
import { GANTT_WORLD_W } from "./gantt-layout.js";

const DAY = 86400000;
const scale: GanttScale = { min: Date.parse("2026-06-01T00:00:00.000Z"), span: 10 * DAY };

describe("gantt-layout time ⇄ x mapping (the drag-to-reschedule math)", () => {
	it("places the axis min at the left edge and the span end at the right edge", () => {
		expect(timeToGanttX(scale.min, scale)).toBeCloseTo(-GANTT_WORLD_W / 2);
		expect(timeToGanttX(scale.min + scale.span, scale)).toBeCloseTo(GANTT_WORLD_W / 2);
	});

	it("dropping a bar at the axis centre reschedules it to the mid-span, keeping its 2-day width", () => {
		const w = ((2 * DAY) / scale.span) * GANTT_WORLD_W; // a 2-day bar's world width
		const { startedAtTime, endedAtTime } = ganttBarTimes(0, w, scale); // centre x → mid of [min, min+span] = 2026-06-06
		expect(startedAtTime).toBe("2026-06-05T00:00:00.000Z");
		expect(endedAtTime).toBe("2026-06-07T00:00:00.000Z");
	});

	it("round-trips: a bar centred at timeToGanttX(t) reschedules back to a span centred on t", () => {
		const start = Date.parse("2026-06-03T00:00:00.000Z");
		const end = Date.parse("2026-06-07T00:00:00.000Z"); // 4-day task, midpoint 2026-06-05
		const w = ((end - start) / scale.span) * GANTT_WORLD_W;
		const centerX = timeToGanttX((start + end) / 2, scale);
		const times = ganttBarTimes(centerX, w, scale);
		expect(times.startedAtTime).toBe("2026-06-03T00:00:00.000Z");
		expect(times.endedAtTime).toBe("2026-06-07T00:00:00.000Z");
	});
});

describe("ganttAxisTicks (calendar marks sized to the span, for a draggable date reference)", () => {
	it("uses daily marks, aligned to UTC midnight, for a short span", () => {
		const ticks = ganttAxisTicks({ min: Date.parse("2026-06-01T00:00:00.000Z"), span: 5 * DAY });
		expect(ticks.map((t) => t.label)).toEqual(["06-01", "06-02", "06-03", "06-04", "06-05", "06-06"]);
		expect(ticks[0].z).toBeCloseTo(-GANTT_WORLD_W / 2); // first tick at the axis min
	});

	it("steps up to a coarser day interval as the span grows (≈8 marks max)", () => {
		const ticks = ganttAxisTicks({ min: Date.parse("2026-01-01T00:00:00.000Z"), span: 100 * DAY });
		expect(ticks.length).toBeLessThanOrEqual(TARGET_OK);
		expect(ticks.every((t, i) => i === 0 || (t.ms - ticks[i - 1].ms) % (14 * DAY) === 0)).toBe(true); // 14-day step
	});

	it("walks calendar months (UTC, no drift) for a multi-month span", () => {
		const ticks = ganttAxisTicks({ min: Date.parse("2026-01-15T00:00:00.000Z"), span: 200 * DAY });
		expect(ticks.map((t) => t.label)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
	});
});

const TARGET_OK = 9; // ~8 target ticks + the trailing boundary
