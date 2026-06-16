import { describe, it, expect } from "vitest";
import { ganttToSvg, ganttToText, type TGanttModel } from "./gantt-renderer.js";
import { quadsToGanttModel, isGanttable } from "./gantt-model.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const day = (d: string): number => Date.parse(d);
const DAY_MS = 86400000;
const q = (subject: string, predicate: string, object: unknown, namedGraph = "Task"): TQuad => ({ subject, predicate, object, namedGraph, timestamp: 1 }) as TQuad;

describe("ganttToSvg", () => {
	const model: TGanttModel = {
		tasks: [
			{ id: "a", label: "Design", start: day("2026-01-01"), end: day("2026-01-05"), effort: 2 * DAY_MS },
			{ id: "b", label: "Build", start: day("2026-01-05"), end: day("2026-01-10"), dependsOn: ["a"] },
		],
	};

	it("emits one g.gantt-task[data-task-id] per task, an effort inner bar, a dependency arrow, and calendar ticks", () => {
		const svg = ganttToSvg(model);
		for (const id of ["a", "b"]) expect(svg).toContain(`data-task-id="${id}"`);
		expect((svg.match(/class="gantt-task"/g) ?? []).length).toBe(2);
		expect(svg).toContain('class="gantt-effort"'); // task a carries effort
		expect(svg).toContain('data-from="a" data-to="b"'); // b depends on a
		expect(svg).toContain("2026-01-01"); // calendar axis tick
	});

	it("renders the empty model and is deterministic", () => {
		expect(ganttToSvg({ tasks: [] })).toContain("No scheduled tasks");
		expect(ganttToSvg(model)).toBe(ganttToSvg(model));
	});

	it("serialises to text deterministically", () => {
		expect(ganttToText(model)).toContain("a: Design [2026-01-01..2026-01-05] effort=" + 2 * DAY_MS);
		expect(ganttToText(model)).toContain("b: Build [2026-01-05..2026-01-10] after a");
	});
});

describe("quadsToGanttModel / isGanttable (fields recognised via the gantt upper concepts)", () => {
	const quads = [
		q("t1", LinkRelations.STARTED_AT_TIME.rel, "2026-01-01"),
		q("t1", LinkRelations.ENDED_AT_TIME.rel, "2026-01-05"),
		q("t1", "name", "Design"),
		q("t2", LinkRelations.STARTED_AT_TIME.rel, "2026-01-05"),
		q("t2", LinkRelations.DURATION.rel, String(4 * DAY_MS)), // no explicit end → derived from duration
		q("t2", LinkRelations.EFFORT.rel, String(2 * DAY_MS)),
		q("t2", LinkRelations.DEPENDS_ON.rel, "t1"),
		q("x", "name", "Not a task"),
	];

	it("extracts start/end, derives end from duration, and carries effort + dependsOn", () => {
		const m = quadsToGanttModel(quads, { displayLabel: (_g, s) => (s === "t1" ? "Design" : undefined) });
		expect(m.tasks.find((t) => t.id === "t1")).toMatchObject({ start: day("2026-01-01"), end: day("2026-01-05"), label: "Design" });
		const t2 = m.tasks.find((t) => t.id === "t2");
		expect(t2?.end).toBe(day("2026-01-05") + 4 * DAY_MS);
		expect(t2?.effort).toBe(2 * DAY_MS);
		expect(t2?.dependsOn).toEqual(["t1"]);
		expect(m.tasks.find((t) => t.id === "x")).toBeUndefined(); // no ganttStart → not a task
	});

	it("isGanttable is true iff some subject carries a ganttStart-kind property", () => {
		expect(isGanttable(quads)).toBe(true);
		expect(isGanttable([q("x", "name", "y")])).toBe(false);
	});
});
