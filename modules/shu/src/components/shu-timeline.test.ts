// @vitest-environment jsdom
/**
 * The live-edge cursor contract: while the timeline is at the live end, it must publish a NULL cursor ("now", no
 * upper bound) — NOT the timestamp of the last event it has processed. A record written after that last event
 * (e.g. a chat comment stamped Date.now()) would otherwise be filtered out as "future" until the next reload.
 * Scrubbing into the past publishes a concrete cutoff. (Regression: ask-on-a-node link missing live, there on reload.)
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ShuTimeline } from "./shu-timeline.js";
import { timeCursor } from "../signals.js";

beforeAll(() => {
	if (!customElements.get("shu-timeline")) customElements.define("shu-timeline", ShuTimeline);
});

describe("shu-timeline live cursor", () => {
	beforeEach(() => timeCursor.set(null));

	it("publishes a null cursor while at the live edge, so a record newer than the last event is not hidden", () => {
		const tl = document.createElement("shu-timeline") as ShuTimeline;
		tl.addEvent({ timestamp: 1000 });
		tl.addEvent({ timestamp: 2000 });
		expect(timeCursor.get(), "at-end ⇒ no upper bound (live = now)").toBeNull();
	});

	it("publishes a concrete past cutoff once scrubbed off the live edge", () => {
		const tl = document.createElement("shu-timeline") as ShuTimeline;
		tl.addEvent({ timestamp: 1000 });
		tl.addEvent({ timestamp: 2000 });
		(tl as unknown as { onRestart(): void }).onRestart(); // scrub to before the first event
		expect(timeCursor.get(), "scrubbed ⇒ a concrete cutoff in the past").toBe(999); // firstEventTime() - 1
	});

	it("returns to a null cursor when scrubbed back to the live end", () => {
		const tl = document.createElement("shu-timeline") as ShuTimeline;
		tl.addEvent({ timestamp: 1000 });
		tl.addEvent({ timestamp: 2000 });
		(tl as unknown as { onRestart(): void }).onRestart();
		expect(timeCursor.get()).toBe(999);
		tl.addEvent({ timestamp: 3000 }); // a new event while scrubbed does NOT advance (atEnd is false) → cursor unchanged
		expect(timeCursor.get(), "a fresh event while scrubbed keeps the past cutoff").toBe(999);
	});

	it("republishing the SAME cursor does NOT re-notify subscribers — no spurious repaint/wiggle on every streamed event", () => {
		timeCursor.set(123); // a non-null start so the first at-end null IS a change
		let notifications = 0;
		const unsub = timeCursor.subscribe(() => notifications++);
		try {
			const tl = document.createElement("shu-timeline") as ShuTimeline;
			tl.addEvent({ timestamp: 1000 }); // at-end → publishes null (123→null = a change) → 1 notify
			tl.addEvent({ timestamp: 2000 }); // at-end → publishes null again (unchanged) → guard skips, NO notify
			tl.addEvent({ timestamp: 3000 }); // ditto
			expect(notifications, "unchanged at-end cursor notifies once, not per event").toBe(1);
		} finally {
			unsub();
		}
	});
});
