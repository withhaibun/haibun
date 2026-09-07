// @vitest-environment jsdom
// Reading a run is a query over the records it wrote: a step and what it said while it ran. What a reader is shown is
// a window of a stated size around where they are, so looking costs the same whether the run has lasted an hour or a
// decade. These pin where a window sits, what it holds and what a level narrows it to.
import { describe, it, expect, beforeEach } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { setConduit, LiveConduit } from "../hypermedia.js";
import { setGraphStore } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { runWindow } from "./run-window.js";

const RUN = "1700000000000-1";
const iso = (n: number): string => new Date(n).toISOString();
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

/** A run of `steps` steps a second apart, each saying one thing at the level given. */
async function aRunOf(steps: number, saying: string = "info"): Promise<QuadStore> {
	const store = new QuadStore();
	for (let i = 0; i < steps; i++) {
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000 + i * 2), endedAtTime: iso(1001 + i * 2) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${RUN}.0.${i}@${i}`, message: `said ${i}`, level: saying, generatedAtTime: iso(1001 + i * 2), isPartOf: `${RUN}.0.${i}` });
	}
	return store;
}

describe("the window of a run a reader is looking at", () => {
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		setConduit(new LiveConduit(""));
		globalThis.fetch = () => Promise.reject(new TypeError("this page has no server"));
		setSiteMetadata({ types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL], rels: { [SEQ_PATH_LABEL]: {}, [LOG_MESSAGE_LABEL]: {}, [RUN_ARTIFACT_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
	});

	it("holds the steps and what they said, oldest first, and says what it spans", async () => {
		setGraphStore(await aRunOf(3));
		const window = await runWindow({ size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 0", "said 0", "step 1", "said 1", "step 2", "said 2"]);
		expect(window.from).toBe(1000);
		expect(window.to).toBe(1005);
		expect(window.rows[0]).toMatchObject({ kind: "step", step: `${RUN}.0.0`, status: "passed", endedAt: 1001 });
		expect(window.rows[1]).toMatchObject({ kind: "said", step: `${RUN}.0.0`, level: "info" });
	});

	it("with no moment named, holds the newest records and nothing before them", async () => {
		setGraphStore(await aRunOf(20));
		const window = await runWindow({ size: 4 });
		expect(window.rows.map((r) => r.text)).toEqual(["step 18", "said 18", "step 19", "said 19"]);
	});

	it("around a moment, holds half before it and half after", async () => {
		setGraphStore(await aRunOf(20));
		const window = await runWindow({ at: 1020, size: 4 });
		expect(window.rows.every((r) => r.at >= 1016 && r.at <= 1023)).toBe(true);
		expect(window.rows.filter((r) => r.at < 1020)).toHaveLength(2);
		expect(window.rows.filter((r) => r.at >= 1020)).toHaveLength(2);
	});

	it("makes a short side up from the other, so a window is the size asked for", async () => {
		setGraphStore(await aRunOf(20));
		const atTheStart = await runWindow({ at: 1000, size: 6 });
		expect(atTheStart.rows, "nothing before the first record, so six after it").toHaveLength(6);
		expect(atTheStart.rows[0].at).toBe(1000);
		const atTheEnd = await runWindow({ at: 1039, size: 6 });
		expect(atTheEnd.rows, "one record at the end, so five before it").toHaveLength(6);
	});

	it("holds no more than the run does", async () => {
		setGraphStore(await aRunOf(2));
		expect((await runWindow({ size: 100 })).rows).toHaveLength(4);
		expect((await runWindow({ at: 1002, size: 100 })).rows).toHaveLength(4);
	});

	it("narrows to the levels at or above the one asked for, since a reader asking for warnings is not shown everything under them", async () => {
		setGraphStore(await aRunOf(3, "debug"));
		const everything = await runWindow({ size: 10, minLevel: "debug" });
		expect(everything.rows).toHaveLength(6);
		const stepsOnly = await runWindow({ size: 10, minLevel: "info" });
		expect(stepsOnly.rows.map((r) => r.text), "a step is at info, and what it said was under it").toEqual(["step 0", "step 1", "step 2"]);
	});

	it("is empty when the run has written nothing, rather than failing", async () => {
		setGraphStore(new QuadStore());
		expect(await runWindow({ size: 10 })).toEqual({ rows: [] });
	});
});

describe("the order a run put its records in", () => {
	// A run outpaces a millisecond, so a clock alone leaves the records of one instant in whatever order they were read.
	// Where a clock cannot tell two apart, their place in the run does.
	beforeEach(() => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		setConduit(new LiveConduit(""));
		globalThis.fetch = () => Promise.reject(new TypeError("this page has no server"));
		setSiteMetadata({ types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL], rels: { [SEQ_PATH_LABEL]: {}, [LOG_MESSAGE_LABEL]: {}, [RUN_ARTIFACT_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
	});

	it("puts the records of one instant in the order the run made them", async () => {
		const store = new QuadStore();
		// Written newest first, as a store reading the newest of a run returns them, and all within one millisecond.
		for (const i of [30, 29, 28, 27, 26]) await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000) });
		setGraphStore(store);
		const window = await runWindow({ size: 10 });
		expect(window.rows.map((r) => r.text), "the newest of them is the last row, which is where a reader following the run is looking").toEqual([
			"step 26",
			"step 27",
			"step 28",
			"step 29",
			"step 30",
		]);
	});
});

describe("what a run says outside every step", () => {
	// A step that fails is reported after it ends, so what the run says about it belongs to no step. Such a statement
	// must not decide which run a window is of, or a reader watching a step fail loses the run they were reading.
	it("keeps the run it is read with, rather than emptying the window", async () => {
		const store = new QuadStore();
		const execution = RUN;
		for (const i of [1, 2, 3]) await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${execution}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000 + i) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${execution}.log.1700000009999`, message: "create: \"ee\" is not a declared type", level: "error", generatedAtTime: iso(1010) });
		setGraphStore(store);
		const window = await runWindow({ size: 10 });
		expect(window.rows.map((r) => r.text), "the run's steps, and what it said about the one that failed").toEqual(["step 1", "step 2", "step 3", 'create: "ee" is not a declared type']);
	});

	it("is read even when it names no execution at all", async () => {
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: "1700000000000-1.0.1", stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: iso(1000) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: "log.1700000009999", message: "said by nothing in particular", level: "warn", generatedAtTime: iso(1010) });
		setGraphStore(store);
		const window = await runWindow({ size: 10 });
		expect(window.rows.map((r) => r.text)).toEqual(["a step", "said by nothing in particular"]);
	});
});

describe("following a run that is still happening", () => {
	// A view holding the window asks only for what has happened since the newest row it holds. Reading the whole window
	// again to find a few new records is what makes following a long run cost what the run costs.
	it("reads what has happened since a moment, and nothing before it", async () => {
		const store = new QuadStore();
		for (const i of [1, 2, 3]) await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000 + i) });
		setGraphStore(store);
		const first = await runWindow({ size: 10 });
		expect(first.rows.map((r) => r.text)).toEqual(["step 1", "step 2", "step 3"]);
		for (const i of [4, 5]) await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.${i}`, stepText: `step ${i}`, actionStatus: "passed", level: "info", generatedAtTime: iso(1000 + i) });
		const since = await runWindow({ size: 10, since: first.to });
		expect(since.rows.map((r) => r.text), "what happened since, and the row at that moment which the reader already holds").toEqual(["step 3", "step 4", "step 5"]);
	});

	it("reads again a step that ended since, whose record changed at its end though it began before", async () => {
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.1`, stepText: "the feature", actionStatus: "running", level: "info", generatedAtTime: iso(1000) });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.2`, stepText: "a step that ended", actionStatus: "passed", level: "info", generatedAtTime: iso(1001), endedAtTime: iso(1002) });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.3`, stepText: "the step now running", actionStatus: "running", level: "info", generatedAtTime: iso(1003) });
		setGraphStore(store);
		const first = await runWindow({ size: 10 });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.3`, stepText: "the step now running", actionStatus: "failed", level: "info", generatedAtTime: iso(1003), endedAtTime: iso(1004) });
		const since = await runWindow({ size: 10, since: first.to });
		expect(since.rows.map((r) => [r.text, r.status]), "the step that ended since, as it is now; not the one that ended before, nor the one still open").toEqual([["the step now running", "failed"]]);
	});

	it("says nothing has happened when nothing has", async () => {
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: `${RUN}.0.1`, stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: iso(1000) });
		setGraphStore(store);
		const first = await runWindow({ size: 10 });
		const since = await runWindow({ size: 10, since: first.to });
		expect(since.rows.map((r) => r.text), "only the row at that moment, which the reader already holds").toEqual(["a step"]);
	});
});
