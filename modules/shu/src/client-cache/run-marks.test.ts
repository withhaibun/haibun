// The shape of a run, drawn from counts rather than rows: a reader looking at a decade reads what a reader looking at
// an hour does. Every reading states the graph it reads, so these read a store made here and install nothing.
import { describe, it, expect } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { MARK_COLOUR } from "../event-marker.js";
import { runGraphOf } from "./run-graph.js";
import { runMarks } from "./run-marks.js";

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

describe("the shape of a run, by division", () => {
	/** A run of the steps and messages given, read through a store made here. */
	const aRun = async (steps: Array<{ at: number; status: string }>, said: Array<{ at: number; level: string }> = []) => {
		const store = new QuadStore();
		for (const [i, s] of steps.entries()) await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: s.status, level: "info", generatedAtTime: iso(s.at) });
		for (const [i, m] of said.entries()) await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${RUN}.0.${i}@${i}`, message: `said ${i}`, level: m.level, generatedAtTime: iso(m.at) });
		return runGraphOf(store);
	};

	it("answers one mark per division, in the order the divisions run", async () => {
		const graph = await aRun([
			{ at: 1000, status: "passed" },
			{ at: 3000, status: "passed" },
		]);
		const marks = await runMarks(graph, { from: 1000, to: 4000, divisions: 3, minLevel: "info" });
		expect(marks.map((m) => m.division)).toEqual([0, 2]);
	});

	it("answers the same number of divisions whatever the span, since the answer is the divisions asked for", async () => {
		const graph = await aRun([{ at: 1000, status: "passed" }]);
		const hour = await runMarks(graph, { from: 1000, to: 1000 + 3600_000, divisions: 4, minLevel: "info" });
		const decade = await runMarks(graph, { from: 1000, to: 1000 + 3600_000 * 24 * 3650, divisions: 4, minLevel: "info" });
		expect(hour.every((m) => m.division < 4)).toBe(true);
		expect(decade.every((m) => m.division < 4)).toBe(true);
	});

	it("marks a division holding a failure as a failure, among however many passes", async () => {
		const graph = await aRun([...Array.from({ length: 20 }, (_, i) => ({ at: 1000 + i, status: "passed" })), { at: 1010, status: "failed" }]);
		const [mark] = await runMarks(graph, { from: 1000, to: 1100, divisions: 1, minLevel: "info" });
		expect(mark.color).toBe(MARK_COLOUR.fault);
	});

	it("marks a division by what it holds most of, counting what the run said as well as what it did", async () => {
		const graph = await aRun([{ at: 1000, status: "passed" }], [
			{ at: 1001, level: "warn" },
			{ at: 1002, level: "warn" },
			{ at: 1003, level: "warn" },
		]);
		const [mark] = await runMarks(graph, { from: 1000, to: 1100, divisions: 1, minLevel: "info" });
		expect(mark.color).toBe(MARK_COLOUR.pending);
	});

	it("marks nothing where the run holds nothing, so an empty stretch draws as empty", async () => {
		const graph = await aRun([]);
		expect(await runMarks(graph, { from: 1000, to: 2000, divisions: 4, minLevel: "info" })).toEqual([]);
	});

	it("leaves out what the level a reader is shown does not carry", async () => {
		const graph = await aRun([], [
			{ at: 1000, level: "debug" },
			{ at: 1001, level: "error" },
		]);
		const marks = await runMarks(graph, { from: 1000, to: 1100, divisions: 1, minLevel: "info" });
		expect(marks.length, "the debug message is not shown at this level, the error is").toBe(1);
		expect(marks[0].color).toBe(MARK_COLOUR.fault);
	});
});
