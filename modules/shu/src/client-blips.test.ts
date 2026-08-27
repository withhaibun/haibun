import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const follow = vi.fn((_request: unknown, _label?: string) => Promise.resolve({}));
let offline = false;
vi.mock("./hypermedia.js", () => ({ conduit: () => ({ follow }) }));
vi.mock("./rpc-registry.js", () => ({ isOffline: () => offline }));

import { recordClientBlip, flushClientBlips, resetClientBlips, clientBlipsRecorded, clientBlipsSent, CLIENT_RING } from "./client-blips.js";

type TSentCall = { params: { batch: { blips: { name: string; value?: number }[]; recorded: number } } };
const sentBatch = () => {
	const last = follow.mock.calls.at(-1);
	if (!last) throw new Error("nothing was sent");
	return (last[0] as unknown as TSentCall).params.batch;
};

describe("recording in the browser: hold it, hand it over in batches", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		follow.mockClear();
		offline = false;
		resetClientBlips();
	});
	afterEach(() => vi.useRealTimers());

	it("does not send a request per occurrence, which is what makes a per-frame recording affordable", async () => {
		for (let i = 0; i < 60; i++) recordClientBlip("haibun.shu.view.thumb_resize", i, { view: "shu-virtual-column" });
		expect(follow).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(follow).toHaveBeenCalledTimes(1);
		expect(sentBatch().blips).toHaveLength(60);
	});

	it("hands them over in the order they happened", async () => {
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		recordClientBlip("haibun.shu.view.scroll", 2, { view: "a" });
		await vi.runAllTimersAsync();
		expect(sentBatch().blips.map((b) => b.value)).toEqual([1, 2]);
	});

	it("sends nothing when nothing happened, so a quiet page costs nothing", async () => {
		await vi.runAllTimersAsync();
		expect(follow).not.toHaveBeenCalled();
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
		expect(follow).toHaveBeenCalledTimes(2);
		expect(sentBatch().blips.map((b) => b.value)).toEqual([2]);
	});

	it("holds without sending when there is no run to send to", async () => {
		offline = true;
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await vi.runAllTimersAsync();
		expect(follow).not.toHaveBeenCalled();
		expect(clientBlipsRecorded()).toBe(1);
	});

	it("keeps the page working when a batch cannot be delivered", async () => {
		follow.mockImplementationOnce(() => Promise.reject(new Error("no route")));
		recordClientBlip("haibun.shu.view.scroll", 1, { view: "a" });
		await expect(flushClientBlips()).resolves.toBeUndefined();
	});
});
