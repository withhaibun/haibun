// The window a tailing view registers with the shared event log, unit-tested pure (no virtualizer): following the live
// edge bounds the log to a tail below the newest event; scrolled back it is the whole history; a run shorter than the
// tail is the whole log. And the bookkeeping that says when to re-register: on a follow flip, and as the edge moves, in
// coarse steps. The monitor's log and the document both tail by this one rule.
import { describe, it, expect, beforeEach } from "vitest";
import { tailWindow, TailWindow } from "./tail-window.js";
import { mergeEvents, resetEventsSnapshot } from "./events-snapshot.js";

const INF = Number.POSITIVE_INFINITY;

describe("tailWindow", () => {
	it("is the full history when not following (a scrolled-back reader must reach anything)", () => {
		expect(tailWindow(false, 1_000_000)).toEqual([{ from: 0, to: INF }]);
	});

	it("is a bounded tail below the newest event when following a long run", () => {
		expect(tailWindow(true, 1_000_000, 600_000)).toEqual([{ from: 400_000, to: INF }]);
	});

	it("clamps `from` at 0: a run shorter than the tail is the whole log (no eviction)", () => {
		expect(tailWindow(true, 300_000, 600_000)).toEqual([{ from: 0, to: INF }]);
	});
});

describe("TailWindow bookkeeping", () => {
	it("re-registers on a follow flip, and not on a repeat of the same state", async () => {
		const tail = new TailWindow({ tailMs: 600_000 });
		expect(tail.follow(true, 1_000_000), "pinned to the live edge: narrow to the tail").toBe(true);
		expect(tail.follow(true, 1_000_000), "still pinned: nothing to do").toBe(false);
		expect(await tail.ranges(1_000_000)).toEqual([{ from: 400_000, to: INF }]);
		expect(tail.follow(false, 1_000_000), "scrolled back: widen to full").toBe(true);
		expect(await tail.ranges(1_000_000)).toEqual([{ from: 0, to: INF }]);
	});

	it("slides the tail only once the edge has moved a quarter of the tail, so eviction runs in chunks", () => {
		const tail = new TailWindow({ tailMs: 600_000 });
		tail.follow(true, 1_000_000); // registered from 400_000
		expect(tail.slide(1_100_000), "moved 100s: under a step").toBe(false);
		expect(tail.slide(1_150_000), "moved 150s: a full step").toBe(true);
		expect(tail.slide(1_200_000), "50s since the last registration: under a step again").toBe(false);
	});

	it("never slides while not following, since the window is the full history then", () => {
		const tail = new TailWindow({ tailMs: 600_000 });
		expect(tail.slide(5_000_000)).toBe(false);
	});
});

describe("the first registration", () => {
	// A view that follows by default has seen no event when it first registers, so it cannot place its tail from its own
	// newest. It is anchored at the run's newest event, which the shared log knows once anything has arrived; the times
	// that place a window are always the events' own, never the clock, so a run from another day is still found.
	beforeEach(() => resetEventsSnapshot());

	it("is already a tail for a view that follows by default, anchored at the newest event the shared log holds", async () => {
		mergeEvents([{ id: "a", timestamp: 4_000_000, kind: "log", level: "info" }, { id: "b", timestamp: 5_000_000, kind: "log", level: "info" }]);
		const tail = new TailWindow({ following: true, tailMs: 600_000 });
		expect(await tail.ranges(0), "boot: no event seen by this view yet").toEqual([{ from: 4_400_000, to: INF }]);
		expect(await tail.ranges(5_100_000), "once events are seen, the newest seen anchors it").toEqual([{ from: 4_500_000, to: INF }]);
		expect(tail.slide(5_100_000), "the anchor was registered, so a move under a step is not a slide").toBe(false);
	});

	it("is the full history for a view that does not follow by default", async () => {
		expect(await new TailWindow({ tailMs: 600_000 }).ranges(0)).toEqual([{ from: 0, to: INF }]);
	});
});
