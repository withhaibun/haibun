// What a device holds of the runs it has read, and what it does when it can hold no more. A record's id names the run
// it belongs to, so forgetting a run is asked of the records rather than of a second index beside them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { individualAsQuads } from "./quad-store.js";
import { setGraphStore } from "../quads-snapshot.js";
import { executionsHeld, forgetExecution, holdOnDevice, noteExecution, readExecution, readingExecution, resetExecutions, subscribeExecutionSwitch } from "./executions.js";

const OLDER = "1700000000000-1";
const NEWER = "1700000009000-2";
const iso = (n: number): string => new Date(n).toISOString();

/** A device holding two runs, each declaring the feature it ran and saying one thing. */
const aDevice = async (): Promise<QuadStore> => {
	const store = new QuadStore();
	for (const [i, execution] of [OLDER, NEWER].entries()) {
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${execution}.0`,
			stepText: `Feature: run ${i}`,
			called: "Haibun.feature",
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(1000 + i * 9000),
		});
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: `${execution}.0.1`,
			stepText: "a step",
			called: "Stepper.act",
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(1100 + i * 9000),
		});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${execution}.0.1@0`, message: "it said this", level: "info", generatedAtTime: iso(1200 + i * 9000) });
	}
	setGraphStore(store);
	return store;
};

/** The records of one run the device still holds, over every type a run writes to. */
const heldOf = async (store: QuadStore, execution: string): Promise<number> => {
	const quads = await store.query({});
	return new Set(quads.filter((q) => q.subject.startsWith(`${execution}.`)).map((q) => q.subject)).size;
};

describe("what a device holds of the runs it has read", () => {
	beforeEach(() => resetExecutions());
	afterEach(() => vi.restoreAllMocks());

	it("names the runs it holds, newest first, by the features each ran", async () => {
		await aDevice();
		expect((await executionsHeld()).map((one) => one.execution)).toEqual([NEWER, OLDER]);
		expect((await executionsHeld())[0].features).toEqual(["run 1"]);
	});

	it("says the run being read changed when a run starts while the page is following the one before it", () => {
		let told = 0;
		const stop = subscribeExecutionSwitch(() => told++);
		noteExecution(OLDER);
		expect(readingExecution()).toBe(OLDER);
		expect(told, "a page learning which run it is reading has not changed run").toBe(0);
		noteExecution(OLDER);
		expect(told, "the same run again is not a change either").toBe(0);
		noteExecution(NEWER);
		expect(told, "the run that started is the one being read, and what is drawn of a run follows it").toBe(1);
		stop();
	});

	it("leaves the run being read alone while a reader has chosen one, whatever the newest records belong to", () => {
		readExecution(OLDER);
		let told = 0;
		const stop = subscribeExecutionSwitch(() => told++);
		noteExecution(NEWER);
		expect(readingExecution(), "the run the reader chose").toBe(OLDER);
		expect(told, "nothing changed for a reader who is reading a run of their own choosing").toBe(0);
		stop();
	});

	it("forgets one run entirely and holds the rest of what it has read", async () => {
		const store = await aDevice();
		expect(await forgetExecution(OLDER)).toBe(3);
		expect(await heldOf(store, OLDER), "nothing of the run it forgot").toBe(0);
		expect(await heldOf(store, NEWER), "every record of the run it kept").toBe(3);
	});

	it("makes room by forgetting the oldest run it is not reading, and holds what it was given", async () => {
		const store = await aDevice();
		readExecution(NEWER);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const setMany = vi.spyOn(store, "setMany").mockRejectedValueOnce(new DOMException("the device is full", "QuotaExceededError"));
		const [, quads] = individualAsQuads(SEQ_PATH_LABEL, {
			[SEQ_PATH_FIELD.id]: `${NEWER}.0.2`,
			stepText: "a later step",
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(20000),
		});
		await holdOnDevice(quads);
		expect(await heldOf(store, OLDER), "the run it was not reading is what made room").toBe(0);
		expect(setMany, "what it was given is written once the room is there").toHaveBeenCalledTimes(2);
		expect(await heldOf(store, NEWER)).toBe(4);
	});

	it("says a device it can free nothing on is full, and goes on reading", async () => {
		const store = await aDevice();
		await forgetExecution(OLDER);
		readExecution(NEWER);
		vi.spyOn(store, "setMany").mockRejectedValue(new DOMException("the device is full", "QuotaExceededError"));
		const [, quads] = individualAsQuads(SEQ_PATH_LABEL, {
			[SEQ_PATH_FIELD.id]: `${NEWER}.0.3`,
			stepText: "a step nothing could hold",
			actionStatus: "passed",
			level: "info",
			generatedAtTime: iso(30000),
		});
		// The failure is reported rather than swallowed: a development build throws it, a built page says it and reads on.
		await expect(holdOnDevice(quads)).rejects.toThrow("the device is full");
	});
});
