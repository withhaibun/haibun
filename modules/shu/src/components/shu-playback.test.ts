// @vitest-environment jsdom
/**
 * Moving the shared time cursor on its own.
 *
 * Where the cursor IS is the log's scroll rail; this is the part a rail cannot do. What matters here is what it
 * publishes: a concrete time while it is playing through the past, and null at the end — "now, no upper bound" — so a
 * record written after the newest event this page has seen is not read as future before its own event arrives.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { ShuPlayback } from "./shu-playback.js";
import { timeCursor } from "../signals.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { mergeEvents, resetEventsSnapshot } from "../events-snapshot.js";
import { SHU_EVENT } from "../consts.js";

const FIRST = 1_000_000;
const LAST = 1_000_500;

let shu: TShuTestHandle;

beforeAll(() => {
	if (!customElements.get("shu-playback")) customElements.define("shu-playback", ShuPlayback);
});

/** A control that has seen a run between FIRST and LAST. */
async function playing(): Promise<ShuPlayback> {
	document.body.innerHTML = "";
	timeCursor.set(null);
	const el = document.createElement("shu-playback") as ShuPlayback;
	document.body.appendChild(el);
	await el.updateComplete;
	// The run's span comes from the shared event log, so that is what a run is put into here — the same call the events
	// controller makes for every view that reads it.
	mergeEvents([
		{ id: "a", timestamp: FIRST, kind: "log", level: "info" },
		{ id: "b", timestamp: LAST, kind: "log", level: "info" },
	]);
	await el.updateComplete;
	return el;
}

/** The frame loop, driven by hand: jsdom does not advance requestAnimationFrame, and a test that waited on real frames
 *  would be waiting on the wall clock. `run(n, ms)` delivers n frames, each ms of elapsed time after the last. */
const frames = {
	queue: [] as FrameRequestCallback[],
	clock: 0,
	install() {
		frames.queue = [];
		frames.clock = 0;
		vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.queue.push(cb));
		vi.stubGlobal("cancelAnimationFrame", () => {
			frames.queue.length = 0;
		});
		vi.spyOn(performance, "now").mockImplementation(() => frames.clock);
	},
	pending(): number {
		return frames.queue.length;
	},
	async run(count: number, ms = 100_000): Promise<void> {
		for (let i = 0; i < count; i++) {
			const cb = frames.queue.shift();
			if (!cb) return;
			frames.clock += ms;
			cb(frames.clock);
			await Promise.resolve();
		}
	},
};

const click = async (el: ShuPlayback, testid: string) => {
	const button = el.shadowRoot?.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
	if (!button) throw new Error(`playback control not rendered: ${testid}`);
	button.click();
	await el.updateComplete;
};

describe("playing through a run", () => {
	beforeEach(() => {
		shu?.teardown();
		// The shared event log is one store for the page, so a run left in it by the last test is still there for the next.
		resetEventsSnapshot();
		shu = setupShuTest();
		frames.install();
		timeCursor.set(null);
	});

	it("offers back-to-start, play, back-to-now and speed, which is all a rail cannot do for itself", async () => {
		const el = await playing();
		for (const id of ["playback-restart", "playback-play", "playback-live", "playback-speed"]) {
			expect(el.shadowRoot?.querySelector(`[data-testid="${id}"]`), id).toBeTruthy();
		}
	});

	it("puts the cursor at the start of the run when asked to go back", async () => {
		const el = await playing();
		await click(el, "playback-restart");
		expect(timeCursor.get(), "just before the first event, so that event is still ahead").toBe(FIRST - 1);
	});

	it("advances the cursor while playing, and publishes now once it arrives at the end", async () => {
		const el = await playing();
		await click(el, "playback-restart");
		expect(timeCursor.get(), "started in the past").toBe(FIRST - 1);
		await click(el, "playback-play");
		await frames.run(1); // one frame long enough to cover the whole run
		await el.updateComplete;
		expect(timeCursor.get(), "the end of a run is 'now', with no upper bound, not the last event's time").toBeNull();
	});

	it("plays on from wherever the cursor was put, since the rail is what moves it", async () => {
		const el = await playing();
		timeCursor.set(FIRST + 100);
		await el.updateComplete;
		await click(el, "playback-play");
		await frames.run(1, 50); // a short frame, so it is still short of the end
		expect(timeCursor.get(), "still a moment in the past, not now").toBe(FIRST + 150);
	});

	it("stops asking for frames once it reaches the end, rather than looping on", async () => {
		const el = await playing();
		await click(el, "playback-restart");
		await click(el, "playback-play");
		await frames.run(1);
		expect(frames.pending(), "nothing left to draw").toBe(0);
	});

	it("does nothing when nothing has happened yet, rather than playing an empty run", async () => {
		document.body.innerHTML = "";
		timeCursor.set(null);
		const el = document.createElement("shu-playback") as ShuPlayback;
		document.body.appendChild(el);
		await el.updateComplete;
		await click(el, "playback-play");
		expect(timeCursor.get()).toBeNull();
	});
});

describe("going back to now", () => {
	// A press on a rail is meant to stay where it was put, so nothing takes a reader off a chosen moment by itself. This
	// is what does: the cursor is released, and any view that tails is asked to return to the live edge and follow again.
	beforeEach(() => {
		shu?.teardown();
		resetEventsSnapshot();
		shu = setupShuTest();
		frames.install();
		timeCursor.set(null);
	});

	it("releases the cursor and asks the tailing views to catch up", async () => {
		const el = await playing();
		const asked: string[] = [];
		document.addEventListener(SHU_EVENT.GO_LIVE, () => asked.push("go-live"));
		timeCursor.set(FIRST + 100);
		await el.updateComplete;
		await click(el, "playback-live");
		expect(timeCursor.get(), "no upper bound any more, which is what now means").toBeNull();
		expect(asked, "and the views that tail are told").toEqual(["go-live"]);
	});
});
