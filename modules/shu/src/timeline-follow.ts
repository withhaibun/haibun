/**
 * timeline-follow — the one shared live-edge follow behaviour for every timeline-following ShuElement (the document,
 * the monitor log, any future live-scrolling view). The system-wide control is the `timeCursor` signal: `null` is the
 * live edge ("now"), a number is a scrubbed cutoff. The timeline bar drives it (play / scrub); the views here follow it.
 *
 * A view HOLDS a controller as a field, exactly like the data controllers:
 *
 *   class ShuFooColumn extends ShuElement<typeof FooSchema> {
 *     #follow = new FollowController(this, () => this.jumpToLiveEdge());
 *     // reader reached / left the live edge: this.#follow.setAtBottom(true | false)
 *     // after appending a row:            this.#follow.stick();
 *   }
 *
 * The rules are identical in every view, so a reader learns them once:
 *  - Auto-scroll to the bottom only while at the live edge (timeCursor === null) AND not scrolled away from it.
 *  - A manual scroll away pauses it; scrolling back to the bottom resumes it.
 *  - Play / scrubbing to the end (timeCursor → null) jumps to the bottom and resumes.
 *  - Clicking a row / scrubbing into the past (timeCursor → a number) is not the live edge, so it never auto-scrolls.
 *
 * The kit owns the follow DECISION and the timeline-signal wiring; the host owns reading its own scroller, because how a
 * scroller reports "at the live edge" differs fundamentally and can't be shared: a plain container reads pixel geometry,
 * but a virtualizer scrolls by ESTIMATED heights of unrendered rows, so it reports via its window reaching the last row
 * and real reader input. The host translates whichever applies into `setAtBottom`.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { timeCursor } from "./signals.js";

export class FollowController implements ReactiveController {
	/** The reader's intent to follow the live edge: true until they scroll away, true again when they return or go live. */
	private following = true;
	private unwatch?: () => void;

	constructor(
		host: ReactiveControllerHost & Element,
		/** Jump to the live edge (the bottom) — the host's own scroll to its last row. For a virtualizer this is
		 *  `scrollToIndex(last, "end")`, re-driven by the host until its window reaches the last row. */
		private jumpToEdge: () => void,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		// Reaching the live edge (play / scrub-to-end publishes a null cursor) re-engages follow and jumps to the bottom.
		this.unwatch = timeCursor.subscribe((c) => {
			if (c === null) {
				this.following = true;
				this.jumpToEdge();
			}
		});
	}

	hostDisconnected(): void {
		this.unwatch?.();
	}

	get isFollowing(): boolean {
		return this.following;
	}

	/** The host reports the reader reaching the live edge (`true`, resume) or scrolling away from it (`false`, pause), read
	 *  however that host's scroller reports it. Only the host's own jump-to-edge and this signal move `following`. */
	setAtBottom(atBottom: boolean): void {
		this.following = atBottom;
	}

	/** Scroll to the live edge if the rules allow (following AND the system is at the live edge). Call after appending a row. */
	stick(): void {
		if (this.following && timeCursor.get() === null) this.jumpToEdge();
	}
}
