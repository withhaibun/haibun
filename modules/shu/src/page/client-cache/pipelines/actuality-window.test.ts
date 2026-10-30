// Reading an actuality is a query over the records it wrote: a step and what it logged while it ran. What a reader is shown is
// a window of a stated size around where they are, so looking takes the same whether actuality has lasted an hour or a
// decade. These pin the place of a window, what it holds and how a level narrows it.
import { describe, it, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { MAX_PAGE_ROWS } from "@haibun/core/lib/domains/hypermedia.js";
import type { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/domains/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import type { THaibunLogLevel } from "@haibun/core/lib/domains/protocol.js";
import { actualityWindow } from "./actuality-window.js";
import { producedUnderSteps, type TActualityRow } from "../derivations/actuality-rows.js";
import type { TActualityGraph } from "../ports.js";
import { actualityGraphOver, actualityStore } from "../actuality-store.test-fake.js";

const RUN = "1700000000000-1";

/** A window of `size` rows at the level a step reports at, without the steps run to carry other steps out, unless named. */
const windowOn = (graph: TActualityGraph, options: { size: number; at?: number; since?: number; minLevel?: THaibunLogLevel; substeps?: boolean }) =>
	actualityWindow(graph, { minLevel: "info", substeps: false, ...options });
const iso = (n: number): string => new Date(n).toISOString();

/** An actuality of `steps` steps a second apart, each logging one thing at the level given. */
async function anActualityOf(steps: number, saying: string = "info"): Promise<QuadStore> {
	const store = actualityStore();
	for (let i = 0; i < steps; i++) {
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			stepText: `step ${i}`,
			actionStatus: "passed",
			accessLevel: "private",
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

describe("the window of an actuality a reader is looking at", () => {
	it("holds the steps and what they logged, oldest first, and reports what it spans", async () => {
		const graph = actualityGraphOver(await anActualityOf(3));
		const window = await windowOn(graph, { size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 0", "said 0", "step 1", "said 1", "step 2", "said 2"]);
		expect(window.from).toBe(1000);
		expect(window.to).toBe(1005);
		expect(window.rows[0]).toMatchObject({ kind: "step", step: `${RUN}.0.0`, status: "passed", endedAt: 1001 });
		expect(window.rows[1]).toMatchObject({ kind: "said", step: `${RUN}.0.0`, level: "info" });
	});

	it("holds the newest records when a moment isn't named, and doesn't hold a record before them", async () => {
		const graph = actualityGraphOver(await anActualityOf(20));
		const window = await windowOn(graph, { size: 4 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 18", "said 18", "step 19", "said 19"]);
	});

	it("around a moment, holds half before it and half after", async () => {
		const graph = actualityGraphOver(await anActualityOf(20));
		const window = await windowOn(graph, { at: 1020, size: 4 });
		expect(window.rows.every((r) => r.at >= 1016 && r.at <= 1023)).toBe(true);
		expect(window.rows.filter((r) => r.at < 1020)).toHaveLength(2);
		expect(window.rows.filter((r) => r.at >= 1020)).toHaveLength(2);
	});

	it("makes a short side up from the other, so a window is the size requested", async () => {
		const graph = actualityGraphOver(await anActualityOf(20));
		const atTheStart = await windowOn(graph, { at: 1000, size: 6 });
		expect(atTheStart.rows, "the window doesn't hold a row before the first record, so six after it").toHaveLength(6);
		expect(itemAt(atTheStart.rows, 0).at).toBe(1000);
		const atTheEnd = await windowOn(graph, { at: 1039, size: 6 });
		expect(atTheEnd.rows, "one record at the end, so five before it").toHaveLength(6);
	});

	it("tops up a window larger than one page by reading pages, as a store rejects a page past its maximum", async () => {
		const graph = actualityGraphOver(await anActualityOf(3));
		const atTheStart = await windowOn(graph, { at: 1000, size: MAX_PAGE_ROWS });
		expect(atTheStart.rows.map((r) => r.text)).toEqual(["step 0", "said 0", "step 1", "said 1", "step 2", "said 2"]);
	});

	it("doesn't hold more than actuality does", async () => {
		const graph = actualityGraphOver(await anActualityOf(2));
		expect((await windowOn(graph, { size: 100 })).rows).toHaveLength(4);
		expect((await windowOn(graph, { at: 1002, size: 100 })).rows).toHaveLength(4);
	});

	it("narrows to the levels at or above the one requested, since a reader reading warnings is not shown everything under them", async () => {
		const graph = actualityGraphOver(await anActualityOf(3, "debug"));
		const everything = await windowOn(graph, { size: 10, minLevel: "debug" });
		expect(everything.rows).toHaveLength(6);
		const stepsOnly = await windowOn(graph, { size: 10, minLevel: "info" });
		expect(
			stepsOnly.rows.map((r) => r.text),
			"a step is at info, and what it logged was under it",
		).toEqual(["step 0", "step 1", "step 2"]);
	});

	it("is empty when actuality hasn't written a record, rather than failing", async () => {
		const graph = actualityGraphOver(actualityStore());
		expect(await windowOn(graph, { size: 10 })).toEqual({ rows: [] });
	});
});

describe("the order an actuality put its records in", () => {
	// An actuality outpaces a millisecond, so a clock alone leaves the records of one instant in whatever order they were read.
	// Where a clock reads two as one instant, their place in actuality orders them.
	it("puts the records of one instant in the order actuality made them", async () => {
		const store = actualityStore();
		// Written newest first, as a store reading the newest of an actuality returns them, and all within one millisecond.
		for (const i of [30, 29, 28, 27, 26])
			await store.upsertIndividual(SEQ_PATH_LABEL, {
				id: `${RUN}.0.${i}`,
				stepText: `step ${i}`,
				actionStatus: "passed",
				accessLevel: "private",
				level: "info",
				generatedAtTime: iso(1000),
			});
		const graph = actualityGraphOver(store);
		const window = await windowOn(graph, { size: 10 });
		expect(
			window.rows.map((r) => r.text),
			"the newest of them is the last row, which is where a reader following actuality is looking",
		).toEqual(["step 26", "step 27", "step 28", "step 29", "step 30"]);
	});
});

describe("what an actuality reports outside every step", () => {
	// A step that fails is reported after it ends, so what actuality reports about it is outside every step. Such a
	// statement must not name the actuality feature a window shows, or a reader watching a step fail loses what they were reading.
	it("keeps the actuality it is read with, rather than emptying the window", async () => {
		const store = actualityStore();
		const actualityFeature = RUN;
		for (const i of [1, 2, 3])
			await store.upsertIndividual(SEQ_PATH_LABEL, {
				id: `${actualityFeature}.0.${i}`,
				stepText: `step ${i}`,
				actionStatus: "passed",
				accessLevel: "private",
				level: "info",
				generatedAtTime: iso(1000 + i),
			});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			id: `${actualityFeature}.log.1700000009999`,
			message: 'create: "ee" is not a declared type',
			level: "error",
			generatedAtTime: iso(1010),
		});
		const graph = actualityGraphOver(store);
		const window = await windowOn(graph, { size: 10 });
		expect(
			window.rows.map((r) => r.text),
			"actuality's steps, and what it logged about the one that failed",
		).toEqual(["step 1", "step 2", "step 3", 'create: "ee" is not a declared type']);
	});

	it("is read even when it doesn't name an actuality feature", async () => {
		const store = actualityStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: "1700000000000-1.0.1",
			stepText: "a step",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1000),
		});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: "log.1700000009999", message: "said by nothing in particular", level: "warn", generatedAtTime: iso(1010) });
		const graph = actualityGraphOver(store);
		const window = await windowOn(graph, { size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["a step", "said by nothing in particular"]);
	});
});

describe("following an actuality that is still happening", () => {
	// A view holding the window reads only what was recorded since the newest recording it holds. Reading the whole
	// window again to find a few new records is what makes following a long actuality take as long as its whole length.
	const step = (store: QuadStore, i: number, at: number, recordedAt: number, more: Record<string, unknown> = {}) =>
		store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.${i}`,
			stepText: `step ${i}`,
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(at),
			recordedAtTime: iso(recordedAt),
			...more,
		});
	const newestRecording = (rows: TActualityRow[]) => Math.max(...rows.map((r) => r.recordedAt ?? 0));

	it("reads what was recorded since the last read, and doesn't read a record from before it", async () => {
		const store = actualityStore();
		for (const i of [1, 2, 3]) await step(store, i, 1000 + i, 1000 + i);
		const graph = actualityGraphOver(store);
		const first = await windowOn(graph, { size: 10 });
		expect(first.rows.map((r) => r.text)).toEqual(["step 1", "step 2", "step 3"]);
		for (const i of [4, 5]) await step(store, i, 1000 + i, 1000 + i);
		const since = await windowOn(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => r.text),
			"what was recorded since, and the record at that instant which the reader already holds",
		).toEqual(["step 3", "step 4", "step 5"]);
	});

	it("finds a record of an earlier moment than the newest row held, when it was recorded after the last read", async () => {
		// A record is written after the moment it records. What an actuality logged or produced during a step is announced at
		// once and recorded a moment later, and the next step can begin in between: a query for records of a later
		// moment than the newest row would pass such a record over for good.
		const store = actualityStore();
		await step(store, 1, 1000, 1000);
		await step(store, 2, 1004, 1004);
		const graph = actualityGraphOver(store);
		const first = await windowOn(graph, { size: 10 });
		expect(first.rows.map((r) => r.text)).toEqual(["step 1", "step 2"]);
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			id: `${RUN}.0.1@0`,
			message: "said during step 1, recorded late",
			level: "info",
			generatedAtTime: iso(1002),
			recordedAtTime: iso(1006),
			isPartOf: `${RUN}.0.1`,
		});
		const since = await windowOn(graph, { size: 10, since: newestRecording(first.rows) });
		expect(since.rows.map((r) => r.text)).toEqual(["said during step 1, recorded late", "step 2"]);
	});

	it("includes a step that ended after the last read, because its record was written again when it ended", async () => {
		const store = actualityStore();
		await step(store, 1, 1000, 1000, { stepText: "the feature", actionStatus: "running" });
		await step(store, 2, 1001, 1002, { stepText: "a step that ended", endedAtTime: iso(1002) });
		await step(store, 3, 1003, 1003, { stepText: "the step now running", actionStatus: "running" });
		const graph = actualityGraphOver(store);
		const first = await windowOn(graph, { size: 10 });
		await step(store, 3, 1003, 1004, { stepText: "the step now running", actionStatus: "failed", endedAtTime: iso(1004) });
		const since = await windowOn(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => [r.text, r.status]),
			"the step that ended after the last read, with its outcome",
		).toEqual([["the step now running", "failed"]]);
	});

	it("names the step whose row carries what it produced, and keeps the produced row for the views that place it", async () => {
		const store = actualityStore();
		await step(store, 1, 1000, 1002, { stepText: "a step of the feature" });
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.1.-1`,
			isPartOf: `${RUN}.0.1`,
			stepText: "take a screenshot",
			actionStatus: "passed",
			accessLevel: "private",
			level: "trace",
			generatedAtTime: iso(1001),
			recordedAtTime: iso(1001),
		});
		await store.upsertIndividual(RUN_ARTIFACT_LABEL, {
			id: `${RUN}.0.1.-1@0`,
			isPartOf: `${RUN}.0.1.-1`,
			artifactType: "image",
			path: "./image/shot.png",
			level: "trace",
			generatedAtTime: iso(1001),
			recordedAtTime: iso(1001),
		});
		// The claim is made where a window is assembled from what more than one read returned, so this reads a window.
		const window = await windowOn(actualityGraphOver(store), { size: 10 });
		producedUnderSteps(window.rows);
		const carried = window.rows.find((r) => r.kind === "produced");
		expect(carried?.carriedBy, "the step a reader is shown claims the shot the machinery under it took").toBe(`${RUN}.0.1`);
		expect(
			window.rows.find((r) => r.kind === "step" && r.text === "a step of the feature")?.produced?.map((one) => one.path),
			"and that step's row shows which shot it carries",
		).toEqual(["./image/shot.png"]);
	});

	it("leaves out the steps run to carry other steps out, and reads them when a reader asks for them", async () => {
		const store = actualityStore();
		await step(store, 1, 1000, 1002, { stepText: "a step of the feature" });
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${RUN}.0.1.-1`,
			isPartOf: `${RUN}.0.1`,
			stepText: "take a screenshot",
			actionStatus: "passed",
			accessLevel: "private",
			level: "trace",
			generatedAtTime: iso(1001),
			recordedAtTime: iso(1001),
		});
		const graph = actualityGraphOver(store);
		expect(
			(await windowOn(graph, { size: 10 })).rows.map((r) => r.text),
			"a reader reading what the feature did",
		).toEqual(["a step of the feature"]);
		const shown = await windowOn(graph, { size: 10, substeps: true });
		expect(
			shown.rows.map((r) => r.text),
			"and a reader asking how it was done",
		).toEqual(["a step of the feature", "take a screenshot"]);
		expect(itemAt(shown.rows, 1).partOf, "the substep names the step it was run to carry out").toEqual([0, 1]);
		expect(itemAt(shown.rows, 0).partOf, "a step of the feature wasn't run to carry out a step, so it doesn't name one").toBeUndefined();
	});

	it("doesn't return a new record when a record wasn't added since the last read", async () => {
		const store = actualityStore();
		await step(store, 1, 1000, 1000, { stepText: "a step" });
		const graph = actualityGraphOver(store);
		const first = await windowOn(graph, { size: 10 });
		const since = await windowOn(graph, { size: 10, since: newestRecording(first.rows) });
		expect(
			since.rows.map((r) => r.text),
			"only the record at that instant, which the reader already holds",
		).toEqual(["a step"]);
	});
});
