import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FollowModel, FollowController } from "./timeline-follow.js";
import { timeCursor } from "./signals.js";

const LIVE = null; // timeCursor at the live edge
const PAST = 42; // a scrubbed cutoff

describe("FollowModel — the pure follow decision", () => {
	it("follows by default and sticks at the live edge", () => {
		const m = new FollowModel();
		expect(m.following).toBe(true);
		expect(m.shouldStick(true)).toBe(true);
	});

	it("never sticks while scrubbed into the past, however it got there (the live gate)", () => {
		const m = new FollowModel();
		expect(m.shouldStick(false)).toBe(false); // clicking a row / scrubbing publishes a past cursor → not live
	});

	it("a scroll away from the bottom pauses; scrolling back to the bottom resumes", () => {
		const m = new FollowModel();
		m.onScrolled(false); // reader scrolls up while live
		expect(m.following).toBe(false);
		expect(m.shouldStick(true)).toBe(false); // ...so the live edge no longer steals the position
		m.onScrolled(true); // reader scrolls back to the end
		expect(m.shouldStick(true)).toBe(true);
	});

	it("going live (play / scrub-to-end) re-engages follow even after a scroll-up", () => {
		const m = new FollowModel();
		m.onScrolled(false);
		m.onGoLive();
		expect(m.following).toBe(true);
		expect(m.shouldStick(true)).toBe(true);
	});

	it("scrolling to the end while scrubbed does NOT resume — only going live does (the two pauses have distinct resumes)", () => {
		const m = new FollowModel();
		m.onScrolled(false); // paused by scrolling up
		m.onScrolled(true); // back at the end...
		expect(m.shouldStick(false)).toBe(false); // ...but still scrubbed (not live) → no auto-scroll
		expect(m.shouldStick(true)).toBe(true); // once live again, it follows
	});
});

/** A DOM-free stand-in for the scroll container: the controller only reads/writes scrollTop/scrollHeight/clientHeight and
 *  (un)subscribes a scroll listener, so a plain object exercises the whole contract without layout. */
function fakeScroller() {
	let handler: (() => void) | null = null;
	return {
		scrollTop: 0,
		scrollHeight: 1000,
		clientHeight: 300,
		addEventListener: (_: string, h: () => void) => {
			handler = h;
		},
		removeEventListener: () => {
			handler = null;
		},
		fireScroll(): void {
			handler?.();
		},
	};
}

describe("FollowController — wiring the model to a scroll element and the timeCursor signal", () => {
	beforeEach(() => timeCursor.set(LIVE));
	afterEach(() => timeCursor.set(LIVE));

	function mount(el: ReturnType<typeof fakeScroller>) {
		const noop = (): void => undefined;
		const host = { addController: noop, removeController: noop, requestUpdate: noop, updateComplete: Promise.resolve(true) };
		const c = new FollowController(host as never, () => el as unknown as HTMLElement);
		c.hostConnected();
		return c;
	}

	it("stick() rides the live edge to the bottom while following and live", () => {
		const el = fakeScroller();
		el.scrollTop = 0;
		const c = mount(el);
		c.stick();
		expect(el.scrollTop).toBe(el.scrollHeight); // pinned to the bottom
	});

	it("stick() leaves a scrolled-up reader alone until they return to the bottom", () => {
		const el = fakeScroller();
		const c = mount(el);
		el.scrollTop = 100; // reader scrolled up (far from scrollHeight 1000)
		el.fireScroll();
		c.stick();
		expect(el.scrollTop).toBe(100); // untouched
		el.scrollTop = el.scrollHeight - el.clientHeight; // scrolled back to the end
		el.fireScroll();
		c.stick();
		expect(el.scrollTop).toBe(el.scrollHeight); // follows again
	});

	it("stick() does nothing while scrubbed into the past (not the live edge)", () => {
		const el = fakeScroller();
		el.scrollTop = 0;
		const c = mount(el);
		timeCursor.set(PAST);
		c.stick();
		expect(el.scrollTop).toBe(0);
	});

	it("reaching the live edge (play / scrub-to-end) jumps to the bottom and re-engages follow", () => {
		const el = fakeScroller();
		const c = mount(el);
		el.scrollTop = 100; // scrolled up
		el.fireScroll();
		timeCursor.set(PAST); // scrub away
		el.scrollTop = 100;
		timeCursor.set(LIVE); // press play → live edge
		expect(el.scrollTop).toBe(el.scrollHeight); // jumped to the bottom
		c.stick();
		expect(el.scrollTop).toBe(el.scrollHeight); // and keeps following
	});
});
