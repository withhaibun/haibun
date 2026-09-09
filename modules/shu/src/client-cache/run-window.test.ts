// Reading a run is a query over the records it wrote: a step and what it said while it ran. What a reader is shown is
// a window of a stated size around where they are, so looking costs the same whether the run has lasted an hour or a
// decade. These pin where a window sits, what it holds and what a level narrows it to.
import { describe, it, expect } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { runWindow, type TRunRow } from "./run-window.js";
import { runGraphOf } from "./run-graph.js";

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();

/** A run of `steps` steps a second apart, each saying one thing at the level given. */
async function aRunOf(steps: number, saying: string = "info"): Promise<QuadStore> {
	const store = new QuadStore();
	for (let i = 0; i < steps; i++) {
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			stepText: `step ${i}`,
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(1000 + i * 2),
			endedAtTime: iso(1001 + i * 2),
			recordedAtTime: iso(1001 + i * 2),
		});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			id: `${RUN}.0.${i}@${i}`,
			message: `said ${i}`,
			level: saying,
			generatedAtTime: iso(1001 + i * 2),
			recordedAtTime: iso(1001 + i * 2),
			isPartOf: `${RUN}.0.${i}`,
		});
	}
	return store;
}

describe("the window of a run a reader is looking at", () => {
	it("holds the steps and what they said, oldest first, and says what it spans", async () => {
		const graph = runGraphOf(await aRunOf(3));
		const window = await runWindow(graph, { size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 0", "said 0", "step 1", "said 1", "step 2", "said 2"]);
		expect(window.from).toBe(1000);
		expect(window.to).toBe(1005);
		expect(window.rows[0]).toMatchObject({ kind: "step", step: `${RUN}.0.0`, status: "passed", endedAt: 1001 });
		expect(window.rows[1]).toMatchObject({ kind: "said", step: `${RUN}.0.0`, level: "info" });
	});

	it("with no moment named, holds the newest records and nothing before them", async () => {
		const graph = runGraphOf(await aRunOf(20));
		const window = await runWindow(graph, { size: 4 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 18", "said 18", "step 19", "said 19"]);
	});

	it("around a moment, holds half before it and half after", async () => {
		const graph = runGraphOf(await aRunOf(20));
		const window = await runWindow(graph, { at: 1020, size: 4 });
		expect(window.rows.every((r) => r.at >= 1016 && r.at <= 1023)).toBe(true);
		expect(window.rows.filter((r) => r.at < 1020)).toHaveLength(2);
		expect(window.rows.filter((r) => r.at >= 1020)).toHaveLength(2);
	});

	it("makes a short side up from the other, so a window is the size asked for", async () => {
		const graph = runGraphOf(await aRunOf(20));
		const atTheStart = await runWindow(graph, { at: 1000, size: 6 });
		expect(atTheStart.rows, "nothing before the first record, so six after it").toHaveLength(6);
		expect(atTheStart.rows[0].at).toBe(1000);
		const atTheEnd = await runWindow(graph, { at: 1039, size: 6 });
		expect(atTheEnd.rows, "one record at the end, so five before it").toHaveLength(6);
	});

	it("holds no more than the run does", async () => {
		const graph = runGraphOf(await aRunOf(2));
		expect((await runWindow(graph, { size: 100 })).rows).toHaveLength(4);
		expect((await runWindow(graph, { at: 1002, size: 100 })).rows).toHaveLength(4);
	});

	it("narrows to the levels at or above the one asked for, since a reader asking for warnings is not shown everything under them", async () => {
		const graph = runGraphOf(await aRunOf(3, "debug"));
		const everything = await runWindow(graph, { size: 10, minLevel: "debug" });
		expect(everything.rows).toHaveLength(6);
		const stepsOnly = await runWindow(graph, { size: 10, minLevel: "info" });
		expect(
			stepsOnly.rows.map((r) => r.text),
			"a step is at info, and what it said was under it",
		).toEqual(["step 0", "step 1", "step 2"]);
	});

	it("is empty when the run has written nothing, rather than failing", async () => {
		const graph = runGraphOf(new QuadStore());
		expect(await runWindow(graph, { size: 10 })).toEqual({ rows: [] });
	});
});

describe("the order a run put its records in", () => {
	// A run outpaces a millisecond, so a clock alone leaves the records of one instant in whatever order they were read.
	// Where a clock cannot tell two apart, their place in the run does.
	it("puts the records of one instant in the order the run made them", async () => {
		const store = new QuadStore();
		// Written newest first, as a store reading the newest of a run returns them, and all within one millisecond.
		for (const i of [30, 29, 28, 27, 26])
			await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000) });
		const graph = runGraphOf(store);
		const window = await runWindow(graph, { size: 10 });
		expect(
			window.rows.map((r) => r.text),
			"the newest of them is the last row, which is where a reader following the run is looking",
		).toEqual(["step 26", "step 27", "step 28", "step 29", "step 30"]);
	});
});

describe("what a run says outside every step", () => {
	// A step that fails is reported after it ends, so what the run says about it belongs to no step. Such a statement
	// must not decide which run a window is of, or a reader watching a step fail loses the run they were reading.
	it("keeps the run it is read with, rather than emptying the window", async () => {
		const store = new QuadStore();
		const execution = RUN;
		for (const i of [1, 2, 3])
			await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${execution}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000 + i) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			id: `${execution}.log.1700000009999`,
			message: 'create: "ee" is not a declared type',
			level: "error",
			generatedAtTime: iso(1010),
		});
		const graph = runGraphOf(store);
		const window = await runWindow(graph, { size: 10 });
		expect(
			window.rows.map((r) => r.text),
			"the run's steps, and what it said about the one that failed",
		).toEqual(["step 1", "step 2", "step 3", 'create: "ee" is not a declared type']);
	});

	it("is read even when it names no execution at all", async () => {
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: "1700000000000-1.0.1", stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: iso(1000) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: "log.1700000009999", message: "said by nothing in particular", level: "warn", generatedAtTime: iso(1010) });
		const graph = runGraphOf(store);
		const window = await runWindow(graph, { size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["a step", "said by nothing in particular"]);
	});
});

describe("following a run that is still happening", () => {
	// A view holding the window asks only for what was recorded since the newest recording it holds. Reading the whole
	// window again to find a few new records is what makes following a long run cost what the run costs.
	const step = (store: QuadStore, i: number, at: number, recordedAt: number, more: Record<string, unknown> = {}) =>
		store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			stepText: `step ${i}`,
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(at),
			recordedAtTime: iso(recordedAt),
			...more,
		});
	const newestRecording = (rows: TRunRow[]) => Math.max(...rows.map((r) => r.recordedAt ?? 0));

	it("reads what was recorded since the last read, and nothing recorded before it", async () => {
		const store = new QuadStore();
		for (const i of [1, 2, 3]) await step(store, i, 1000 + i, 1000 + i);
		const graph = runGraphOf(store);
		const first = await runWindow(graph, { size: 10 });
		expect(first.rows.map((r) => r.text)).toEqual(["step 1", "step 2", "step 3"]);
		for (const i of [4, 5]) await step(store, i, 1000 + i, 1000 + i);
		const since = await runWindow(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => r.text),
			"what was recorded since, and the record at that instant which the reader already holds",
		).toEqual(["step 3", "step 4", "step 5"]);
	});

	it("finds a record of an earlier moment than the newest row held, when it was recorded after the last read", async () => {
		// A record is written after the moment it is of. What a run said or produced during a step is announced at
		// once and recorded a moment later, and the next step can begin in between: asking for what is of a later
		// moment than the newest row would pass such a record over for good.
		const store = new QuadStore();
		await step(store, 1, 1000, 1000);
		await step(store, 2, 1004, 1004);
		const graph = runGraphOf(store);
		const first = await runWindow(graph, { size: 10 });
		expect(first.rows.map((r) => r.text)).toEqual(["step 1", "step 2"]);
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			id: `${RUN}.0.1@0`,
			message: "said during step 1, recorded late",
			level: "info",
			generatedAtTime: iso(1002),
			recordedAtTime: iso(1006),
			isPartOf: `${RUN}.0.1`,
		});
		const since = await runWindow(graph, { size: 10, since: newestRecording(first.rows) });
		expect(since.rows.map((r) => r.text)).toEqual(["said during step 1, recorded late", "step 2"]);
	});

	it("includes a step that ended after the last read, because its record was written again when it ended", async () => {
		const store = new QuadStore();
		await step(store, 1, 1000, 1000, { stepText: "the feature", actionStatus: "running" });
		await step(store, 2, 1001, 1002, { stepText: "a step that ended", endedAtTime: iso(1002) });
		await step(store, 3, 1003, 1003, { stepText: "the step now running", actionStatus: "running" });
		const graph = runGraphOf(store);
		const first = await runWindow(graph, { size: 10 });
		await step(store, 3, 1003, 1004, { stepText: "the step now running", actionStatus: "failed", endedAtTime: iso(1004) });
		const since = await runWindow(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => [r.text, r.status]),
			"the step that ended after the last read, with its outcome",
		).toEqual([["the step now running", "failed"]]);
	});

	it("names the step whose row carries what it produced, and keeps the produced row for the views that place it", async () => {
		const store = new QuadStore();
		await step(store, 1, 1000, 1002, { stepText: "a step of the feature" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.1.-1`, isPartOf: `${RUN}.0.1`, stepText: "take a screenshot", actionStatus: "passed", level: "trace", generatedAtTime: iso(1001), recordedAtTime: iso(1001) });
		await store.upsertIndividual(RUN_ARTIFACT_LABEL, { id: `${RUN}.0.1.-1@0`, isPartOf: `${RUN}.0.1.-1`, artifactType: "image", path: "./image/shot.png", level: "trace", generatedAtTime: iso(1001), recordedAtTime: iso(1001) });
		const window = await runWindow(runGraphOf(store), { size: 10 });
		const carried = window.rows.find((r) => r.kind === "produced");
		expect(carried?.carriedBy, "the step a reader is shown claims the shot the machinery under it took").toBe(`${RUN}.0.1`);
		expect(
			window.rows.find((r) => r.kind === "step" && r.text === "a step of the feature")?.produced?.map((one) => one.path),
			"and that step's row says which shot it carries",
		).toEqual(["./image/shot.png"]);
	});

	it("leaves out the steps run to carry other steps out, and reads them when a reader asks for them", async () => {
		const store = new QuadStore();
		await step(store, 1, 1000, 1002, { stepText: "a step of the feature" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.1.-1`, isPartOf: `${RUN}.0.1`, stepText: "take a screenshot", actionStatus: "passed", level: "trace", generatedAtTime: iso(1001), recordedAtTime: iso(1001) });
		const graph = runGraphOf(store);
		expect((await runWindow(graph, { size: 10 })).rows.map((r) => r.text), "a reader reading what the feature did").toEqual(["a step of the feature"]);
		const shown = await runWindow(graph, { size: 10, substeps: true });
		expect(shown.rows.map((r) => r.text), "and a reader asking how it was done").toEqual(["a step of the feature", "take a screenshot"]);
		expect(shown.rows[1].partOf, "the substep names the step it was run to carry out").toEqual([0, 1]);
		expect(shown.rows[0].partOf, "a step of the feature was run to carry out no step, so it names none").toBeUndefined();
	});

	it("says nothing has happened when nothing was recorded", async () => {
		const store = new QuadStore();
		await step(store, 1, 1000, 1000, { stepText: "a step" });
		const graph = runGraphOf(store);
		const first = await runWindow(graph, { size: 10 });
		const since = await runWindow(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => r.text),
			"only the record at that instant, which the reader already holds",
		).toEqual(["a step"]);
	});
});
