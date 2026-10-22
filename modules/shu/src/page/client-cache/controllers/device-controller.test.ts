// What a device holds of the actualities it has read, and what it does when it can't hold more. A record's id names its
// actuality feature, and the actuality feature names its actuality, so deleting an actuality reads the records rather than a second index
// beside them.
import { newPage } from "../../../test/setup.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { SEQ_PATH_FIELD, actualityFeatureOf } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { individualAsQuads } from "../derivations/quads.js";
import {
	followRecordedActualityFeature,
	noteActualityFeature,
	readActualityFeature,
	readHeldGraph,
	readingActualityFeature,
	installGraph,
	subscribeActualityFeatureSwitch,
} from "./device-controller.js";
import { actualitiesHeld, deleteActuality, holdOnDevice, type THeldActuality } from "./held-actualities-controller.js";
import { actualityStore } from "../actuality-store.test-fake.js";

const OLDER_ACTUALITY = "1700000000000";
const NEWER_ACTUALITY = "1700000009000";
const OLDER = actualityFeatureOf({ key: OLDER_ACTUALITY, featureNum: 1 });
const NEWER = actualityFeatureOf({ key: NEWER_ACTUALITY, featureNum: 1 });
const NEWER_SECOND = actualityFeatureOf({ key: NEWER_ACTUALITY, featureNum: 2 });
const iso = (n: number): string => new Date(n).toISOString();

/** Writes an actuality feature: the step that declared it, a step, and what that step logged. */
const aFeature = async (store: QuadStore, actualityFeature: string, feature: string, at: number): Promise<void> => {
	const record = { actionStatus: "passed", accessLevel: "private", level: "info" };
	await store.upsertIndividual(SEQ_PATH_LABEL, { ...record, id: `${actualityFeature}.0`, stepText: `Feature: ${feature}`, called: "Haibun.feature", generatedAtTime: iso(at) });
	await store.upsertIndividual(SEQ_PATH_LABEL, { ...record, id: `${actualityFeature}.0.1`, stepText: "a step", called: "Stepper.act", generatedAtTime: iso(at + 100) });
	await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: `${actualityFeature}.0.1@0`, message: "it said this", level: "info", generatedAtTime: iso(at + 200) });
};

/** A device holding two actualities: the older ran one feature, and the newer ran two. Each actuality's own record is
 *  the record of its feature 0. */
const aDevice = async (): Promise<QuadStore> => {
	const store = actualityStore();
	for (const [key, at] of [
		[OLDER_ACTUALITY, 900],
		[NEWER_ACTUALITY, 9900],
	] as const)
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			id: actualityFeatureOf({ key, featureNum: 0 }),
			stepText: "tests",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			actualityLevel: "actuality",
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

	it("reports a change of the actuality feature being read when an actuality feature starts while the page follows the one before it", () => {
		let told = 0;
		const stop = subscribeActualityFeatureSwitch(() => told++);
		noteActualityFeature(OLDER);
		expect(readingActualityFeature()).toBe(OLDER);
		expect(told, "a page reading its first actuality feature hasn't switched from another").toBe(0);
		noteActualityFeature(OLDER);
		expect(told, "the same actuality feature again is not a change either").toBe(0);
		noteActualityFeature(NEWER);
		expect(told, "the actuality feature that started is the one being read, and what is drawn of an actuality feature follows it").toBe(1);
		stop();
	});

	it("leaves the actuality feature being read alone while a reader has chosen one, whatever the newest records belong to", () => {
		readActualityFeature(OLDER);
		let told = 0;
		const stop = subscribeActualityFeatureSwitch(() => told++);
		noteActualityFeature(NEWER);
		expect(readingActualityFeature(), "the actuality feature the reader chose").toBe(OLDER);
		expect(told, "a reader who is reading an actuality feature of their own choosing isn't told of a change").toBe(0);
		stop();
	});

	it("follows the actuality feature being recorded again when a reader who chose one asks for now", async () => {
		await aDevice();
		noteActualityFeature(NEWER);
		readActualityFeature(OLDER);
		let told = 0;
		const stop = subscribeActualityFeatureSwitch(() => told++);
		followRecordedActualityFeature();
		expect(readingActualityFeature(), "the actuality feature being recorded").toBe(NEWER);
		expect(told, "the views reading an actuality feature receive its change").toBe(1);
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
		readActualityFeature(NEWER);
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
		expect(await heldOf(store, NEWER_ACTUALITY), "the actuality of the actuality feature being read, with every feature's records").toBe(8);
	});

	it("doesn't copy a window it read from another graph the device holds into the graph of the actuality the site serves", async () => {
		const served = await aDevice();
		const setMany = vi.spyOn(served, "setMany");
		readHeldGraph(actualityStore());
		const [, quads] = individualAsQuads(SEQ_PATH_LABEL, {
			[SEQ_PATH_FIELD.id]: `${OLDER}.0.2`,
			stepText: "a step of the held actuality",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(2000),
		});
		await holdOnDevice(quads);
		expect(setMany).not.toHaveBeenCalled();
		readHeldGraph(served);
		await holdOnDevice(quads);
		expect(setMany, "a window read from the site is held").toHaveBeenCalledWith(quads);
	});

	it("reports a device is full when it can't free a record there, and goes on reading", async () => {
		const store = await aDevice();
		await deleteActuality(await held(OLDER_ACTUALITY));
		readActualityFeature(NEWER);
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
