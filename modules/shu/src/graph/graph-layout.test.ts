import { describe, it, expect } from "vitest";
import { computeLayout } from "./graph-layout.js";
import type { NodeMark } from "./graph-scene.js";
import { timeToGanttX } from "./gantt-layout.js";
import { GANTT_ROW_H, GANTT_WORLD_W } from "./gantt-layout.js";

const DAY = 86400000;
const mark = (id: string, role: NodeMark["role"], over: Partial<NodeMark> = {}): NodeMark => ({
	id,
	type: over.type ?? "T",
	kind: over.kind ?? "chip",
	label: id,
	color: "#abc",
	role,
	...over,
});
const day = (d: string): number => Date.parse(d);

describe("computeLayout (backend-neutral layout pass)", () => {
	it("leaves free marks unplaced (force layout owns x/y; z is the recorded depth)", () => {
		const r = computeLayout([mark("a", { kind: "free" }), mark("b", { kind: "free" })]);
		expect(r.placements.size).toBe(0);
		expect(r.adornment).toBeNull();
		expect(r.scale).toBeUndefined();
	});

	it("pins xyz marks at their explicit coordinates", () => {
		const r = computeLayout([mark("p", { kind: "xyz", x: 1, y: 2, z: 3 })]);
		expect(r.placements.get("p")).toEqual({ x: 1, y: 2, z: 3 });
	});

	it("places geo marks by a naive lon→x / lat→y projection", () => {
		const r = computeLayout([mark("g", { kind: "geo", lat: 51, lon: -2 })]);
		const p = r.placements.get("g");
		expect(p?.x).toBeCloseTo(-4); // lon * 2
		expect(p?.y).toBeCloseTo(102); // lat * 2
	});

	it("lays time marks on one shared calendar scale: lanes by start, z centre, zExtent ∝ duration", () => {
		// A 10-day span; durations 2d, 4d, 1d → proportional widths (the bar-width invariant).
		const marks = [
			mark("t2", { kind: "time", start: day("2026-06-04"), end: day("2026-06-08") }, { kind: "box" }), // 4 days
			mark("t1", { kind: "time", start: day("2026-06-01"), end: day("2026-06-03") }, { kind: "box" }), // 2 days, earliest
			mark("t3", { kind: "time", start: day("2026-06-10"), end: day("2026-06-11") }, { kind: "box" }), // 1 day, latest → span end
		];
		const r = computeLayout(marks);
		const span = 10 * DAY;
		const scale = r.scale ?? { min: 0, span: 1 };
		expect(scale).toEqual({ min: day("2026-06-01"), span });
		// Lanes are assigned in start order (t1, t2, t3), top → down by GANTT_ROW_H.
		const top = GANTT_ROW_H; // (3-1)/2 * ROW_H
		expect(r.placements.get("t1")?.y).toBeCloseTo(top);
		expect(r.placements.get("t2")?.y).toBeCloseTo(top - GANTT_ROW_H);
		expect(r.placements.get("t3")?.y).toBeCloseTo(top - 2 * GANTT_ROW_H);
		// z is the bar centre on the calendar axis; zExtent ∝ duration (2/10, 4/10, 1/10 of GANTT_WORLD_W).
		expect(r.placements.get("t1")?.z).toBeCloseTo(timeToGanttX((day("2026-06-01") + day("2026-06-03")) / 2, scale));
		expect(r.placements.get("t1")?.zExtent).toBeCloseTo((2 / 10) * GANTT_WORLD_W);
		expect(r.placements.get("t2")?.zExtent).toBeCloseTo((4 / 10) * GANTT_WORLD_W);
		expect(r.placements.get("t3")?.zExtent).toBeCloseTo((1 / 10) * GANTT_WORLD_W);
		// All time bars share x = 0 (the lane axis); time is z.
		expect(r.placements.get("t2")?.x).toBe(0);
	});

	it("emits a calendar-axis adornment below the lowest lane spanning the scale, with ticks", () => {
		const marks = [
			mark("t1", { kind: "time", start: day("2026-06-01"), end: day("2026-06-05") }, { kind: "box" }),
			mark("t2", { kind: "time", start: day("2026-06-05"), end: day("2026-06-09") }, { kind: "box" }),
		];
		const r = computeLayout(marks);
		expect(r.adornment?.kind).toBe("calendar-axis");
		expect(r.adornment?.baseY).toBeCloseTo(GANTT_ROW_H / 2 - GANTT_ROW_H - GANTT_ROW_H); // top(=ROW_H/2) - (n-1)*ROW_H - ROW_H
		expect(r.adornment?.zMin).toBeCloseTo(-GANTT_WORLD_W / 2);
		expect(r.adornment?.zMax).toBeCloseTo(GANTT_WORLD_W / 2);
		expect(r.adornment?.ticks.length ?? 0).toBeGreaterThan(0);
	});

	it("places only the time marks in a mixed set; free ones stay unplaced", () => {
		const r = computeLayout([mark("task", { kind: "time", start: 0, end: DAY }, { kind: "box" }), mark("person", { kind: "free" })]);
		expect(r.placements.has("task")).toBe(true);
		expect(r.placements.has("person")).toBe(false);
	});
});
