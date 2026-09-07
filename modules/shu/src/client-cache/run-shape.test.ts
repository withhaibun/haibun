// The shape of a run, drawn from counts rather than rows: a reader looking at a decade reads what a reader looking at
// an hour does, and a run that grows is counted only where it has grown. Every reading states the graph it reads, so
// these read a store made here and install nothing.
import { describe, it, expect } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import type { TDensityQuery } from "@haibun/core/lib/quad-types.js";
import { MARK_COLOUR } from "../event-marker.js";
import { runGraphOf, type TRunGraph } from "./run-graph.js";
import { runShape } from "./run-shape.js";

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

/** A run of the steps and messages given, and what was counted of it: the store is added to as a run adds to itself. */
const aRun = async (steps: Array<{ at: number; status: string }> = [], said: Array<{ at: number; level: string }> = []) => {
	const store = new QuadStore();
	const counted: TDensityQuery[] = [];
	const addStep = async (at: number, status: string, i: number) => store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: status, level: "info", generatedAtTime: iso(at) });
	const addSaid = async (at: number, level: string, i: number) => store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${RUN}.0.${i}@${i}`, message: `said ${i}`, level, generatedAtTime: iso(at) });
	for (const [i, s] of steps.entries()) await addStep(s.at, s.status, i);
	for (const [i, m] of said.entries()) await addSaid(m.at, m.level, 100 + i);
	const over = runGraphOf(store);
	const graph: TRunGraph = { ...over, density: (query) => (counted.push(query), over.density(query)) };
	let more = steps.length;
	return { graph, counted, step: (at: number, status: string) => addStep(at, status, more++) };
};

describe("the shape of a run, by division", () => {
	it("answers one mark per division, in the order the divisions run", async () => {
		const { graph } = await aRun([
			{ at: 1000, status: "passed" },
			{ at: 3000, status: "passed" },
		]);
		const shape = runShape(graph, { divisions: 3 });
		await shape.update(3000);
		expect(shape.marks.map((m) => m.division)).toEqual([0, 2]);
	});

	it("draws in the divisions asked for whatever the run's length, since the answer's size is the divisions", async () => {
		const anHour = await aRun([{ at: 1000, status: "passed" }, { at: 1000 + 3600_000, status: "passed" }]);
		const aDecade = await aRun([{ at: 1000, status: "passed" }, { at: 1000 + 3600_000 * 24 * 3650, status: "passed" }]);
		const hour = runShape(anHour.graph, { divisions: 4 });
		const decade = runShape(aDecade.graph, { divisions: 4 });
		await hour.update(1000 + 3600_000);
		await decade.update(1000 + 3600_000 * 24 * 3650);
		expect(hour.marks.every((m) => m.division < 4)).toBe(true);
		expect(decade.marks.every((m) => m.division < 4)).toBe(true);
		expect(aDecade.counted.length, "a decade is counted in as many reads as an hour").toBe(anHour.counted.length);
	});

	it("marks a division holding a failure as a failure, among however many passes", async () => {
		const { graph } = await aRun([...Array.from({ length: 20 }, (_, i) => ({ at: 1000 + i, status: "passed" })), { at: 1010, status: "failed" }]);
		const shape = runShape(graph, { divisions: 1 });
		await shape.update(1020);
		expect(shape.marks[0].color).toBe(MARK_COLOUR.fault);
	});

	it("marks a division by what it holds most of, counting what the run said as well as what it did", async () => {
		const { graph } = await aRun([{ at: 1000, status: "passed" }], [
			{ at: 1001, level: "warn" },
			{ at: 1002, level: "warn" },
			{ at: 1003, level: "warn" },
		]);
		const shape = runShape(graph, { divisions: 1 });
		await shape.update(1003);
		expect(shape.marks[0].color).toBe(MARK_COLOUR.pending);
	});

	it("marks nothing where the run holds nothing, and counts nothing either", async () => {
		const { graph, counted } = await aRun([]);
		const shape = runShape(graph, { divisions: 4 });
		await shape.update(2000);
		expect(shape.marks).toEqual([]);
		expect(counted, "a run with no records has no shape to count").toEqual([]);
	});

	it("leaves out what the level a reader is shown does not carry", async () => {
		const { graph } = await aRun([], [
			{ at: 1000, level: "debug" },
			{ at: 1001, level: "error" },
		]);
		const shape = runShape(graph, { divisions: 1 });
		await shape.update(1001);
		expect(shape.marks.length, "the debug message is not shown at this level, the error is").toBe(1);
		expect(shape.marks[0].color).toBe(MARK_COLOUR.fault);
	});

	it("counts only what the run has recorded since the last count", async () => {
		const { graph, counted, step } = await aRun([
			{ at: 1000, status: "passed" },
			{ at: 1100, status: "passed" },
			{ at: 1200, status: "passed" },
			{ at: 1300, status: "passed" },
		]);
		const shape = runShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		await step(1350, "passed");
		await shape.update(1350);
		const since = counted.slice(first);
		expect(since.length, "one read per type counted, over the stretch the run has grown by").toBe(first);
		expect(since.every((q) => Date.parse(q.from) > 1000), "the divisions already counted are not read again").toBe(true);
	});

	it("reads nothing at all where the run has not moved since it was counted", async () => {
		const { graph, counted } = await aRun([{ at: 1000, status: "passed" }, { at: 1300, status: "passed" }]);
		const shape = runShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		await shape.update(1300);
		expect(counted.length).toBe(first);
	});

	it("doubles the division when the run outgrows the grid, adding the counts either side of each new boundary rather than reading them again", async () => {
		const { graph, counted, step } = await aRun([
			{ at: 1000, status: "failed" },
			{ at: 1100, status: "failed" },
			{ at: 1200, status: "passed" },
			{ at: 1300, status: "passed" },
		]);
		const shape = runShape(graph, { divisions: 4 });
		await shape.update(1300);
		const first = counted.length;
		const wide = shape.beginningOf(1) - shape.beginningOf(0);
		await step(1500, "passed");
		await shape.update(1500);
		const since = counted.slice(first);
		expect(since.every((q) => Date.parse(q.from) > 1100), "the stretch holding the failures is not read again").toBe(true);
		expect(shape.marks.find((m) => m.division === 0)?.color, "what the merged divisions held is what the division that replaced them holds").toBe(MARK_COLOUR.fault);
		expect(shape.beginningOf(1) - shape.beginningOf(0), "each division covers twice the stretch it did").toBe(wide * 2);
	});
});
