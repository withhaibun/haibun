// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { TLink } from "./hypermedia.js";
import { CLIENT_RING, clientBlipsRecorded, clientBlipsSent, flushClientBlips, recordClientBlip } from "./client-blips.js";
import { endPage } from "./page-pinned.js";
import { carryARun, setupShuTest, type TShuTestHandle } from "./test-setup.js";

type TBatch = { blips: { name: string; value?: number }[]; recorded: number };
/** Each batch the page handed the run, by the link it followed. */
const sent: TLink[] = [];
/** What the run answers a batch with, which a case makes a failure. */
let delivered: () => unknown = () => ({});
const sentBatch = (): TBatch => {
	const last = sent.at(-1);
	if (!last) throw new Error("nothing was sent");
	return last.params?.batch as TBatch;
};

describe("recording in the browser: hold it, hand it over in batches", () => {
	// A page records from the moment it loads, so each case is a page of its own, which ends with the case.
	let t: TShuTestHandle;
	beforeEach(() => {
		vi.useFakeTimers();
		sent.length = 0;
		delivered = () => ({});
		t = setupShuTest({
			dispatch: (_method, _params, link) => {
				sent.push(link);
				return delivered();
			},
		});
	});
	afterEach(() => {
		t.teardown();
		vi.useRealTimers();
	});

	it("does not send a request per occurrence, which is what makes a per-frame recording sustainable", async () => {
		for (let i = 0; i < 60; i++) recordClientBlip("haibun.shu.view.thumb_resize", i, { view: "shu-virtual-column" });
		expect(sent).toEqual([]);
		await vi.runAllTimersAsync();
		expect(sent).toHaveLength(1);
		expect(sentBatch().blips).toHaveLength(60);
	});

	it("hands a batch over as a read: the run doesn't retain a blip, so it doesn't record the batch either", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		const link = sent.at(-1);
		expect(link?.method).toBe("MonitorStepper-recordClientBlips");
		expect(link?.asks, "an act is recorded as a step whose events reach the page; a read is not").toBe("read");
	});

	it("hands them over in the order they happened", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		recordClientBlip("haibun.shu.view.scroll", 2, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sentBatch().blips.map((b) => b.value)).toEqual([1, 2]);
	});

	it("doesn't send a batch when a blip isn't recorded, so a quiet page doesn't make a call", async () => {
		await vi.runAllTimersAsync();
		expect(sent).toEqual([]);
	});

	it("keeps the most recent occurrences when the buffer fills, and says how many it saw", async () => {
		const over = CLIENT_RING + 30;
		for (let i = 0; i < over; i++) recordClientBlip("haibun.shu.view.scroll", i, { view: "a" });
		await vi.runAllTimersAsync();
		const batch = sentBatch();
		expect(batch.blips).toHaveLength(CLIENT_RING);
		expect(batch.blips[0].value).toBe(over - CLIENT_RING);
		expect(batch.recorded).toBe(over);
		expect(clientBlipsRecorded()).toBe(over);
		expect(clientBlipsSent()).toBe(CLIENT_RING);
	});

	it("starts a fresh buffer after handing one over, rather than sending the same occurrence twice", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		recordClientBlip("haibun.shu.view.scroll", 2, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sent).toHaveLength(2);
		expect(sentBatch().blips.map((b) => b.value)).toEqual([2]);
	});

	it("holds without sending when the page doesn't reach a run", async () => {
		carryARun();
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sent).toEqual([]);
		expect(clientBlipsRecorded()).toBe(1);
	});

	it("holds without sending on a page mounted without a conduit, such as a bundle under test or a still", async () => {
		// The page ends, and the one after it doesn't install a conduit.
		endPage();
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sent).toEqual([]);
		expect(clientBlipsRecorded()).toBe(1);
	});

	it("keeps the page working when a batch cannot be delivered", async () => {
		delivered = () => {
			throw new Error("no route");
		};
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await expect(flushClientBlips()).resolves.toBeUndefined();
	});
});
