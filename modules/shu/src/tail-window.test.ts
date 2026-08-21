// What a tailing view holds of the shared event log, counted in events: the newest page (the shared window-size setting)
// while pinned to the live edge; one page more each time the reader nears the top of what is held, back to the start of
// the run; one page again when the reader returns to the live edge. Pure bookkeeping, no virtualizer: the monitor's log
// and the document both tail by this one rule.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TailWindow } from "./tail-window.js";
import { windowSizeSetting, DEFAULT_WINDOW_SIZE } from "./components/shu-window-size.js";

describe("TailWindow", () => {
	beforeEach(() => windowSizeSetting.set("50"));
	afterEach(() => windowSizeSetting.set(DEFAULT_WINDOW_SIZE));

	it("wants one page of the shared window size while pinned to the live edge", () => {
		const tail = new TailWindow({ following: true });
		expect(tail.count()).toBe(50);
		windowSizeSetting.set("2000");
		expect(tail.count(), "the setting is read live, so a change re-sizes every tailing view").toBe(2000);
	});

	it("widens by one page when the reader nears the top of what is held, and not before", () => {
		const tail = new TailWindow({ following: true });
		tail.follow(false); // scrolled back from the live edge
		expect(tail.widenIfNear(40, 50, false), "forty rows from the top: not near").toBe(false);
		expect(tail.widenIfNear(10, 50, false), "within a quarter page of the top: widen").toBe(true);
		expect(tail.count()).toBe(100);
		expect(tail.widenIfNear(3, 100, false), "near the top again: one more page").toBe(true);
		expect(tail.count()).toBe(150);
	});

	it("does not widen while following, at the start of the run, or with nothing held", () => {
		const tail = new TailWindow({ following: true });
		expect(tail.widenIfNear(0, 50, false), "pinned to the live edge: the top is not being read").toBe(false);
		tail.follow(false);
		expect(tail.widenIfNear(0, 50, true), "the start of the run is held: nothing older to ask for").toBe(false);
		expect(tail.widenIfNear(0, 0, false), "nothing held yet: nothing to be near the top of").toBe(false);
	});

	it("narrows back to one page when the reader returns to the live edge, and only then re-registers", () => {
		const tail = new TailWindow({ following: true });
		tail.follow(false);
		tail.widenIfNear(0, 50, false);
		tail.widenIfNear(0, 100, false);
		expect(tail.count()).toBe(150);
		expect(tail.follow(false), "still scrolled back: nothing to do").toBe(false);
		expect(tail.follow(true), "back at the live edge: one page again").toBe(true);
		expect(tail.count()).toBe(50);
		expect(tail.follow(true), "already there").toBe(false);
	});

	it("narrows back to its page once live events have carried it a quarter page past, in chunks rather than per event", () => {
		const tail = new TailWindow({ following: true });
		expect(tail.slide(55), "five past the page: not yet").toBe(false);
		expect(tail.slide(63), "a quarter page past: re-register, which evicts the oldest").toBe(true);
		tail.follow(false);
		expect(tail.slide(500), "scrolled back: what is held is wanted, nothing narrows").toBe(false);
	});

	it("starts following or not as its view does", () => {
		expect(new TailWindow({ following: true }).following).toBe(true);
		expect(new TailWindow().following).toBe(false);
	});
});
