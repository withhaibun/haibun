import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FollowController } from "./timeline-follow.js";
import { timeCursor } from "./signals.js";

const LIVE = null; // timeCursor at the live edge
const PAST = 42; // a scrubbed cutoff

describe("FollowController: the follow decision, wired to a host jump-to-edge and the timeCursor signal", () => {
	beforeEach(() => timeCursor.set(LIVE));
	afterEach(() => timeCursor.set(LIVE));

	/** The host's jump-to-edge is a spy: the controller never touches the scroller itself (the host reads its own scroller
	 *  and reports at-the-edge via setAtBottom), so a counter exercises the whole contract without any DOM. */
	function mount() {
		let jumps = 0;
		const noop = (): void => undefined;
		const host = { addController: noop, removeController: noop, requestUpdate: noop, updateComplete: Promise.resolve(true) };
		const c = new FollowController(host as never, () => {
			jumps += 1;
		});
		c.hostConnected();
		return { c, jumps: () => jumps };
	}

	it("follows by default: stick() jumps to the live edge", () => {
		const { c, jumps } = mount();
		expect(c.isFollowing).toBe(true);
		c.stick();
		expect(jumps()).toBe(1);
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

	it("stick() does nothing while scrubbed into the past (not the live edge)", () => {
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
		expect(jumps()).toBe(0); // ...but still scrubbed (not live), so no auto-scroll
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
