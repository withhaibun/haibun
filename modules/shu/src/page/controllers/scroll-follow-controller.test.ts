import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ScrollFollowController } from "./scroll-follow-controller.js";
import { timeCursor } from "../root.js";

const LIVE = null; // timeCursor at the live edge
const PAST = 42; // a scrubbed cutoff

describe("ScrollFollowController: the follow decision, wired to a host jump-to-edge and the page's cursor", () => {
	beforeEach(() => timeCursor.set(LIVE));
	afterEach(() => timeCursor.set(LIVE));

	/** The host's jump-to-edge is a spy: the controller never touches the scroller itself (the host reads its own scroller
	 *  and reports at-the-edge via setAtBottom), so a counter exercises the whole contract without any DOM. */
	function mount(arrivedAfter?: () => number, placeNow?: () => number | null) {
		let jumps = 0;
		let holdsEdge = true;
		const noop = (): void => undefined;
		const host = { addController: noop, removeController: noop, requestUpdate: noop, updateComplete: Promise.resolve(true) };
		const c = new ScrollFollowController(
			host as never,
			() => {
				jumps += 1;
				return holdsEdge;
			},
			{ ...(arrivedAfter ? { arrivedAfter } : {}), ...(placeNow ? { placeNow } : {}) },
		);
		c.view.hostConnected();
		c.hostConnected();
		return { c, jumps: () => jumps, holds: (held: boolean) => (holdsEdge = held) };
	}

	it("follows by default: stick() jumps to the live edge", () => {
		const { c, jumps } = mount();
		expect(c.isFollowing).toBe(true);
		c.stick();
		expect(jumps()).toBe(1);
	});

	it("issues again a jump its scroller ignored, once the scroller holds the new rows", () => {
		const { c, jumps, holds } = mount();
		holds(false); // a row was added, and the virtualizer hasn't taken in the new count yet
		c.stick();
		expect(jumps(), "the jump is issued, and the scroller doesn't hold its target").toBe(1);
		c.rowsArrived();
		expect(jumps(), "the scroller took in rows without the target, so the jump is issued again").toBe(2);
		holds(true);
		c.rowsArrived();
		expect(jumps(), "the virtualizer now holds the row at the end").toBe(3);
		c.rowsArrived();
		expect(jumps(), "a jump that landed isn't issued again").toBe(3);
	});

	it("doesn't issue an ignored jump again once the reader scrolled away or scrubbed into the past", () => {
		const { c, jumps, holds } = mount();
		holds(false);
		c.stick();
		c.setAtBottom(false);
		holds(true);
		c.rowsArrived();
		expect(jumps(), "the reader scrolled away before the rows arrived").toBe(1);
		c.setAtBottom(true);
		holds(false);
		c.stick();
		timeCursor.set(PAST);
		c.rowsArrived();
		expect(jumps(), "the page left the live edge before the rows arrived").toBe(2);
	});

	it("stick() leaves a reader who scrolled away alone until they report back at the edge", () => {
		const { c, jumps } = mount();
		c.setAtBottom(false); // host reports the reader scrolled away (real input on a virtualizer, geometry on a plain scroller)
		c.stick();
		expect(jumps()).toBe(0); // untouched
		c.setAtBottom(true); // host reports back at the edge (window reached the last row)
		c.stick();
		expect(jumps()).toBe(1); // follows again
	});

	it("stick() doesn't jump while scrubbed into the past (not the live edge)", () => {
		const { c, jumps } = mount();
		timeCursor.set(PAST);
		c.stick();
		expect(jumps()).toBe(0);
	});

	it("returning to the bottom while scrubbed does NOT auto-scroll, only going live does (the two pauses have distinct resumes)", () => {
		const { c, jumps } = mount();
		c.setAtBottom(false);
		c.setAtBottom(true); // back at the end...
		timeCursor.set(PAST);
		c.stick();
		expect(jumps()).toBe(0); // ...but still scrubbed (not live), so it doesn't auto-scroll
	});

	it("states what its host holds after the reader's place while they read where they are, and doesn't state a count at the end", () => {
		let after = 0;
		const { c } = mount(() => after);
		after = 3;
		expect(c.arrived, "a view at the end doesn't hold a record to return to").toBe(0);
		c.setAtBottom(false);
		expect(c.arrived, "what the host holds after the place they hold").toBe(3);
		after = 2;
		expect(c.arrived, "read rather than counted, so a removed record isn't counted").toBe(2);
		c.setAtBottom(true);
		expect(c.arrived, "and doesn't state a count once they are back at the end").toBe(0);
	});

	it("holds the place its host states, so a view leaving the live edge holds an instant rather than null", () => {
		const { c } = mount(undefined, () => PAST);
		expect(timeCursor.get(), "the page is at the live edge, where its cursor doesn't state an instant").toBe(null);
		c.setAtBottom(false);
		expect(c.view.cursor, "the view holds where the host states the reader is").toBe(PAST);
		expect(c.view.tracking).toBe(false);
		c.setAtBottom(true);
		expect(c.view.tracking, "and the reader reaching the end reads the page again").toBe(true);
	});

	it("reaching the live edge (play / scrub-to-end) jumps to the edge and re-engages follow", () => {
		const { c, jumps } = mount();
		c.setAtBottom(false); // scrolled away
		timeCursor.set(PAST); // scrub away
		timeCursor.set(LIVE); // press play → live edge
		expect(jumps()).toBe(1); // jumped on going live
		expect(c.isFollowing).toBe(true);
		c.stick();
		expect(jumps()).toBe(2); // and keeps following
	});
});
