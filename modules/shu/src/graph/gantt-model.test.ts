import { describe, it, expect } from "vitest";
import { quadsToGanttModel, isGanttable, cascadeReschedule } from "./gantt-model.js";
import type { TGanttTask } from "./gantt-model.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

const DAY_MS = 86400000;
const day = (d: string): number => Date.parse(d);
const q = (subject: string, predicate: string, object: unknown, namedGraph = "Task"): TQuad => ({ subject, predicate, object, namedGraph, timestamp: 1 }) as TQuad;

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

	it("sorts tasks by start then id", () => {
		const m = quadsToGanttModel(quads);
		expect(m.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
	});

	it("a start-kind instant with no end is a zero-length milestone task, placed at its moment", () => {
		const m = quadsToGanttModel([q("note", LinkRelations.STARTED_AT_TIME.rel, "2026-08-03")]);
		expect(m.tasks).toHaveLength(1);
		expect(m.tasks[0]).toMatchObject({ id: "note", start: day("2026-08-03"), end: day("2026-08-03") });
	});

	it("a record's generation time is NOT subject time: generatedAtTime alone yields no task", () => {
		expect(quadsToGanttModel([q("rec", LinkRelations.GENERATED_AT_TIME.rel, "2026-08-03")]).tasks).toHaveLength(0);
	});

	it("several start-kind/end-kind times aggregate to the true interval (min start, max end), regardless of quad order", () => {
		const m = quadsToGanttModel([
			q("s", LinkRelations.ENDED_AT_TIME.rel, "2026-01-05"),
			q("s", LinkRelations.GANTT_START.rel, "2026-01-03"),
			q("s", LinkRelations.STARTED_AT_TIME.rel, "2026-01-01"),
		]);
		expect(m.tasks[0]).toMatchObject({ start: day("2026-01-01"), end: day("2026-01-05") });
	});

	it("isGanttable is true iff some subject carries a ganttStart-kind property", () => {
		expect(isGanttable(quads)).toBe(true);
		expect(isGanttable([q("x", "name", "y")])).toBe(false);
	});
});

describe("cascadeReschedule (dragging a task shifts its transitive dependents)", () => {
	const DAY = 86400000;
	const t = (id: string, start: number, end: number, dependsOn?: string[]): TGanttTask => ({ id, label: id, start, end, dependsOn });
	// a → b → c chain, plus d depending on a directly, plus an unrelated e
	const tasks: TGanttTask[] = [t("a", 0, DAY), t("b", DAY, 2 * DAY, ["a"]), t("c", 2 * DAY, 3 * DAY, ["b"]), t("d", DAY, 2 * DAY, ["a"]), t("e", 0, DAY)];

	it("shifts the dragged task and everything transitively downstream by the same delta", () => {
		const shifted = cascadeReschedule("a", 5 * DAY, tasks);
		expect([...shifted.keys()].sort()).toEqual(["a", "b", "c", "d"]); // e is unrelated → untouched
		expect(shifted.get("a")).toEqual({ start: 5 * DAY, end: 6 * DAY });
		expect(shifted.get("c")).toEqual({ start: 7 * DAY, end: 8 * DAY }); // two hops downstream, same delta
		expect(shifted.has("e")).toBe(false);
	});

	it("shifts only the subtree below the dragged task", () => {
		const shifted = cascadeReschedule("b", -DAY, tasks);
		expect([...shifted.keys()].sort()).toEqual(["b", "c"]); // a (upstream) + d/e unaffected
		expect(shifted.get("b")).toEqual({ start: 0, end: DAY });
	});
});
