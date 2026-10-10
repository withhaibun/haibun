// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import type { TLink } from "./hypermedia.js";
import { CLIENT_RING } from "./domains/elements.js";
import { clientBlipsRecorded, clientBlipsSent, flushClientBlips, recordClientBlip } from "./client-blips.js";
import { endPage } from "./page-pinned.js";
import { carryARun, openReportingPage, setupShuTest, type TShuTestHandle } from "./test-setup.js";
import { CLIENT_LOG_METHOD } from "./client-log.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";

/** The read a page holds to send its occurrences to actuality. */
const PRIVATE_READ = readAction(Access.private);

type TBatch = { blips: { name: string; value?: number }[]; recorded: number };
/** The link of each batch the page sent to actuality. */
const sent: TLink[] = [];
/** Returns actuality's response to a call. A case replaces it to make a call fail. */
let delivered: (link: TLink) => unknown = () => ({});
const sentBatch = (): TBatch => {
	const last = sent.at(-1);
	if (!last) throw new Error("the page didn't send a batch");
	return last.params?.batch as TBatch;
};

describe("recording in the browser: the page holds occurrences and sends them in batches", () => {
	// A page records from the moment it loads, so each case opens its own page. The page ends with the case.
	let t: TShuTestHandle;
	beforeEach(async () => {
		// Only the flush delay is faked. The page key a case opens is read from an IndexedDB that responds on real tasks.
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		sent.length = 0;
		delivered = () => ({});
		t = setupShuTest({
			dispatch: (_method, _params, link) => {
				sent.push(link);
				return delivered(link);
			},
		});
		// The page holds the read of what actuality records, as an owner's page does.
		await openReportingPage(undefined, [PRIVATE_READ]);
	});
	afterEach(() => {
		t.teardown();
		vi.useRealTimers();
	});

	it("doesn't send a request per occurrence, so a view can record an occurrence every frame", async () => {
		for (let i = 0; i < 60; i++) recordClientBlip("haibun.shu.view.thumb_resize", i, { view: "shu-virtual-column" });
		expect(sent).toEqual([]);
		await vi.runAllTimersAsync();
		expect(sent).toHaveLength(1);
		expect(sentBatch().blips).toHaveLength(60);
	});

	it("sends a batch as a read: actuality doesn't retain a blip, so it doesn't record the batch", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		const link = sent.at(-1);
		expect(link?.method).toBe("MonitorStepper-recordClientBlips");
		expect(link?.asks, "an act is recorded as a step whose events reach the page; a read is not").toBe("read");
	});

	it("sends the occurrences in the order they happened", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		recordClientBlip("haibun.shu.view.scroll", 2, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sentBatch().blips.map((b) => b.value)).toEqual([1, 2]);
	});

	it("doesn't send a batch when the page hasn't recorded a blip, so an idle page doesn't make a call", async () => {
		await vi.runAllTimersAsync();
		expect(sent).toEqual([]);
	});

	it("keeps the most recent occurrences when the buffer fills, and reports how many it recorded", async () => {
		const over = CLIENT_RING + 30;
		for (let i = 0; i < over; i++) recordClientBlip("haibun.shu.view.scroll", i, { view: "a" });
		await vi.runAllTimersAsync();
		const batch = sentBatch();
		expect(batch.blips).toHaveLength(CLIENT_RING);
		expect(itemAt(batch.blips, 0).value).toBe(over - CLIENT_RING);
		expect(batch.recorded).toBe(over);
		expect(clientBlipsRecorded()).toBe(over);
		expect(clientBlipsSent()).toBe(CLIENT_RING);
	});

	it("starts a new buffer after sending one, so it doesn't send an occurrence twice", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		recordClientBlip("haibun.shu.view.scroll", 2, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sent).toHaveLength(2);
		expect(sentBatch().blips.map((b) => b.value)).toEqual([2]);
	});

	it("holds without sending on a page that carries a cached run and doesn't reach a server", async () => {
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

	it("keeps its occurrences where the page doesn't hold the read of what actuality records", async () => {
		await openReportingPage();
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await flushClientBlips();
		expect(sent.filter((link) => link.method !== CLIENT_LOG_METHOD)).toEqual([]);
	});

	it("keeps the page working when a batch isn't delivered, and reports the failure to actuality", async () => {
		delivered = (link) => {
			if (link.method === CLIENT_LOG_METHOD) return {};
			throw new Error("offline");
		};
		await openReportingPage(undefined, [PRIVATE_READ]);
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await expect(flushClientBlips()).resolves.toBeUndefined();
		const report = sent.find((link) => link.method === CLIENT_LOG_METHOD);
		expect(report?.params).toMatchObject({ event: { level: "warn", source: "client-blips", message: "a batch holding 1 of the page's occurrences wasn't delivered: offline" } });
	});
});
