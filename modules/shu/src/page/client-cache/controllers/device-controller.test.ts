// What a device holds of the actualities it has read, and what it does when it can't hold more. A record's id names its
// execution, and the execution names its actuality, so deleting an actuality reads the records rather than a second index
// beside them.
import { newPage } from "../../../test/setup.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { SEQ_PATH_FIELD, executionOf } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { individualAsQuads } from "../derivations/quads.js";
import { followRecordedExecution, noteExecution, readExecution, readingExecution, installGraph, subscribeExecutionSwitch } from "./device-controller.js";
import { actualitiesHeld, deleteActuality, holdOnDevice, type THeldActuality } from "./held-actualities-controller.js";
import { actualityStore } from "../actuality-store.test-fake.js";

const OLDER_ACTUALITY = "1700000000000";
const NEWER_ACTUALITY = "1700000009000";
const OLDER = executionOf({ key: OLDER_ACTUALITY, featureNum: 1 });
const NEWER = executionOf({ key: NEWER_ACTUALITY, featureNum: 1 });
const NEWER_SECOND = executionOf({ key: NEWER_ACTUALITY, featureNum: 2 });
const iso = (n: number): string => new Date(n).toISOString();

/** Writes a feature's execution: the step that declared it, a step, and what that step logged. */
const aFeature = async (store: QuadStore, execution: string, feature: string, at: number): Promise<void> => {
	const record = { actionStatus: "passed", accessLevel: "private", level: "info" };
	await store.upsertIndividual(SEQ_PATH_LABEL, { ...record, id: `${execution}.0`, stepText: `Feature: ${feature}`, called: "Haibun.feature", generatedAtTime: iso(at) });
	await store.upsertIndividual(SEQ_PATH_LABEL, { ...record, id: `${execution}.0.1`, stepText: "a step", called: "Stepper.act", generatedAtTime: iso(at + 100) });
	await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${execution}.0.1@0`, message: "it said this", level: "info", generatedAtTime: iso(at + 200) });
};

/** A device holding two actualities: the older ran one feature, and the newer ran two. Each actuality's own record is
 *  the record of its execution of feature 0. */
const aDevice = async (): Promise<QuadStore> => {
	const store = actualityStore();
	for (const [key, at] of [
		[OLDER_ACTUALITY, 900],
		[NEWER_ACTUALITY, 9900],
	] as const)
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: executionOf({ key, featureNum: 0 }),
			stepText: "tests",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			actualityLevel: "execution",
			generatedAtTime: iso(at),
		});
	await aFeature(store, OLDER, "the older one", 1000);
	await aFeature(store, NEWER, "the first of the newer", 10000);
	await aFeature(store, NEWER_SECOND, "the second of the newer", 11000);
	installGraph(store);
	return store;
};

/** One actuality as the device lists it. */
const held = async (actuality: string): Promise<THeldActuality> => {
	const found = (await actualitiesHeld()).find((one) => one.actuality === actuality);
	if (!found) throw new Error(`the device doesn't list ${actuality}`);
	return found;
};

/** The records of one actuality the device still holds, over every type an actuality writes. */
const heldOf = async (store: QuadStore, actuality: string): Promise<number> => {
	const quads = await store.query({});
	return new Set(quads.filter((q) => q.subject.startsWith(`${actuality}-`)).map((q) => q.subject)).size;
};

describe("what a device holds of the actualities it has read", () => {
	beforeEach(newPage);
	afterEach(() => vi.restoreAllMocks());

	it("names the actualities it holds, newest first, by the features each ran in the order it ran them", async () => {
		await aDevice();
		expect((await actualitiesHeld()).map((one) => one.actuality)).toEqual([NEWER_ACTUALITY, OLDER_ACTUALITY]);
		expect(itemAt(await actualitiesHeld(), 0).features).toEqual(["the first of the newer", "the second of the newer"]);
		expect(itemAt(await actualitiesHeld(), 0).newest, "a reader of the actuality reads its newest feature").toBe(NEWER_SECOND);
	});

	it("reports a change of the execution being read when an execution starts while the page follows the one before it", () => {
		let told = 0;
		const stop = subscribeExecutionSwitch(() => told++);
		noteExecution(OLDER);
		expect(readingExecution()).toBe(OLDER);
		expect(told, "a page reading its first execution hasn't switched from another").toBe(0);
		noteExecution(OLDER);
		expect(told, "the same execution again is not a change either").toBe(0);
		noteExecution(NEWER);
		expect(told, "the execution that started is the one being read, and what is drawn of an execution follows it").toBe(1);
		stop();
	});

	it("leaves the execution being read alone while a reader has chosen one, whatever the newest records belong to", () => {
		readExecution(OLDER);
		let told = 0;
		const stop = subscribeExecutionSwitch(() => told++);
		noteExecution(NEWER);
		expect(readingExecution(), "the execution the reader chose").toBe(OLDER);
		expect(told, "a reader who is reading an execution of their own choosing isn't told of a change").toBe(0);
		stop();
	});

	it("follows the execution being recorded again when a reader who chose one asks for now", async () => {
		await aDevice();
		noteExecution(NEWER);
		readExecution(OLDER);
		let told = 0;
		const stop = subscribeExecutionSwitch(() => told++);
		followRecordedExecution();
		expect(readingExecution(), "the execution being recorded").toBe(NEWER);
		expect(told, "the views reading an execution receive its change").toBe(1);
		stop();
	});

	it("deletes one actuality entirely, its own record and every feature's, and holds the rest of what it has read", async () => {
		const store = await aDevice();
		expect(await deleteActuality(await held(NEWER_ACTUALITY))).toBe(7);
		expect(await heldOf(store, NEWER_ACTUALITY), "it doesn't hold a record of the actuality it deleted").toBe(0);
		expect(await heldOf(store, OLDER_ACTUALITY), "every record of the actuality it kept").toBe(4);
	});

	it("makes room by deleting the oldest actuality it is not reading, and holds what it was given", async () => {
		const store = await aDevice();
		readExecution(NEWER);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const setMany = vi.spyOn(store, "setMany").mockRejectedValueOnce(new DOMException("the device is full", "QuotaExceededError"));
		const [, quads] = individualAsQuads(SEQ_PATH_LABEL, {
			[SEQ_PATH_FIELD.id]: `${NEWER}.0.2`,
			stepText: "a later step",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(20000),
		});
		await holdOnDevice(quads);
		expect(await heldOf(store, OLDER_ACTUALITY), "the actuality it was not reading is what made room").toBe(0);
		expect(setMany, "what it was given is written once the room is there").toHaveBeenCalledTimes(2);
		expect(await heldOf(store, NEWER_ACTUALITY), "the actuality of the execution being read, with every feature's records").toBe(8);
	});

	it("reports a device is full when it can't free a record there, and goes on reading", async () => {
		const store = await aDevice();
		await deleteActuality(await held(OLDER_ACTUALITY));
		readExecution(NEWER);
		vi.spyOn(store, "setMany").mockRejectedValue(new DOMException("the device is full", "QuotaExceededError"));
		const [, quads] = individualAsQuads(SEQ_PATH_LABEL, {
			[SEQ_PATH_FIELD.id]: `${NEWER}.0.3`,
			stepText: "a step nothing could hold",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(30000),
		});
		// The failure is reported rather than discarded: a development build throws it, a built page logs it and goes on reading.
		await expect(holdOnDevice(quads)).rejects.toThrow("the device is full");
	});
});
