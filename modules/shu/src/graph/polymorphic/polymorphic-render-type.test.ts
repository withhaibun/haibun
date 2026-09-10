import { describe, it, expect } from "vitest";
import { buildRenderTypeRegistry, type RenderTypeDeps, type SeqRenderDeps } from "./polymorphic-render-type.js";
import { VIEW } from "./polymorphic-views.js";
import type { GanttTarget } from "./polymorphic-data-pipeline.js";

// Everything a view type decides about its own axes, plane and labels is declared on the view type, so the scene can
// draw any of them without asking which one it holds. These tests read those declarations through the registry the
// scene builds, so a new view type that forgets one is visible here rather than in a scene branch.

const DAY = 86_400_000;
const target = (start: number, len: number): GanttTarget => ({ y: 10, z: start + len / 2, start, end: start + len, zLen: len });

const registry = (deps: Partial<RenderTypeDeps> = {}, seq: Partial<SeqRenderDeps> = {}) =>
	buildRenderTypeRegistry({ ganttTarget: () => undefined, ganttPlacement: () => ({ count: 0 }), ...deps }, { seqNodes: () => [], seqEdges: () => [], labelOf: (id) => id, ...seq });

describe("what each view type declares about its own drawing", () => {
	it("only the sequence draws in one plane, and it says which", () => {
		const r = registry();
		expect(r.get(VIEW.sequence)?.lanePlaneX).toBe(0);
		for (const v of [VIEW.force, VIEW.td, VIEW.lr, VIEW.gantt]) expect(r.get(v)?.lanePlaneX).toBeUndefined();
	});

	it("only the sequence caps a node with its label, since a participant's name heads its lifeline", () => {
		const r = registry();
		expect(r.get(VIEW.sequence)?.capsNodeLabels).toBe(true);
		for (const v of [VIEW.force, VIEW.td, VIEW.lr, VIEW.gantt]) expect(r.get(v)?.capsNodeLabels).toBe(false);
	});

	it("only gantt draws a calendar ruler: the sequence's lifelines are its actor chips", () => {
		const r = registry();
		expect(r.get(VIEW.gantt)?.drawsCalendarAxis).toBe(true);
		for (const v of [VIEW.force, VIEW.td, VIEW.lr, VIEW.sequence]) expect(r.get(v)?.drawsCalendarAxis).toBe(false);
	});
});

describe("the axis legend names what the axes mean, and only gantt's do", () => {
	const scale = { min: Date.UTC(2026, 0, 5), span: 3 * DAY };

	it("gantt names the calendar span it placed its bars on and how many it placed", () => {
		const gantt = registry({ ganttPlacement: () => ({ scale, count: 4 }) }).get(VIEW.gantt);
		expect(gantt?.axisLegend()).toEqual({ from: "2026-01-05", to: "2026-01-08", count: 4 });
	});

	it("a gantt with nothing placed has no legend, since there is no span to name", () => {
		expect(
			registry({ ganttPlacement: () => ({ scale, count: 0 }) })
				.get(VIEW.gantt)
				?.axisLegend(),
		).toBeNull();
		expect(
			registry({ ganttPlacement: () => ({ count: 3 }) })
				.get(VIEW.gantt)
				?.axisLegend(),
		).toBeNull();
	});

	it("every other view leaves its axes unnamed", () => {
		const r = registry({ ganttPlacement: () => ({ scale, count: 4 }) });
		for (const v of [VIEW.force, VIEW.td, VIEW.lr, VIEW.sequence]) expect(r.get(v)?.axisLegend()).toBeNull();
	});
});

describe("a layered view says which way its ranks read", () => {
	it("top-down advances along y and left-right along x", () => {
		const r = registry();
		expect(r.get(VIEW.td)?.layeredFlow()).toEqual({ direction: "td", flowAxis: "y" });
		expect(r.get(VIEW.lr)?.layeredFlow()).toEqual({ direction: "lr", flowAxis: "x" });
	});

	it("a view that is not a layered flow has none", () => {
		const r = registry();
		for (const v of [VIEW.force, VIEW.gantt, VIEW.sequence]) expect(r.get(v)?.layeredFlow()).toBeNull();
	});
});

describe("a gantt bar's placement and its span come from the one target", () => {
	const start = Date.UTC(2026, 0, 5);
	const r = registry({ ganttTarget: (id) => (id === "task-1" ? target(start, 2 * DAY) : undefined) });

	it("the lane the force pulls to and the depth the node is placed at are the same reading", () => {
		expect(r.get(VIEW.gantt)?.lanePlacement("task-1")).toEqual({ y: 10, z: start + DAY });
	});

	it("the bar's span is the calendar context its type presenter paints from", () => {
		expect(r.get(VIEW.gantt)?.markTime("task-1")).toEqual({ start, end: start + 2 * DAY, zExtent: 2 * DAY });
	});

	it("a node with no target is a point in time, not a bar", () => {
		expect(r.get(VIEW.gantt)?.lanePlacement("task-2")).toBeUndefined();
		expect(r.get(VIEW.gantt)?.markTime("task-2")).toBeUndefined();
	});
});
