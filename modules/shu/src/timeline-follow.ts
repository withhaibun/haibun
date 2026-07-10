/**
 * timeline-follow — the one shared live-edge follow behaviour for every timeline-following ShuElement (the document,
 * the monitor log, any future live-scrolling view). The system-wide control is the `timeCursor` signal: `null` is the
 * live edge ("now"), a number is a scrubbed cutoff. The timeline bar drives it (play / scrub); the views here follow it.
 *
 * A view HOLDS a controller as a field, exactly like the data controllers:
 *
 *   class ShuFooColumn extends ShuElement<typeof FooSchema> {
 *     #follow = new FollowController(this, () => this.scrollEl);   // scrollEl is the view's own scroll container
 *     // after appending/rendering content: this.#follow.stick();
 *   }
 *
 * The rules are identical in every view, so a reader learns them once:
 *  - Auto-scroll to the bottom only while at the live edge (timeCursor === null) AND not scrolled away from it.
 *  - A manual scroll away pauses it; scrolling back to the bottom resumes it.
 *  - Play / scrubbing to the end (timeCursor → null) jumps to the bottom and resumes.
 *  - Clicking a row / scrubbing into the past (timeCursor → a number) is not the live edge, so it never auto-scrolls.
 *
 * FollowModel holds the whole decision with no DOM, so it is exhaustively unit-testable; FollowController is the thin
 * wiring to a scroll element and the signal.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { timeCursor } from "./signals.js";

/** The pure follow decision — no DOM. `following` is the reader's intent to follow the live edge; combined with the
 *  system-wide live state it decides whether the view stays pinned to the bottom. */
export class FollowModel {
	private _following: boolean;
	constructor(following = true) {
		this._following = following;
	}
	get following(): boolean {
		return this._following;
	}
	/** A manual scroll: at the bottom re-engages follow, away from it pauses. */
	onScrolled(atBottom: boolean): void {
		this._following = atBottom;
	}
	/** Going live — timeline play, or a scrub back to the end (timeCursor → null) — re-engages follow (the view jumps to the edge). */
	onGoLive(): void {
		this._following = true;
	}
	/** Stick to the bottom only while following AND the system is at the live edge. */
	shouldStick(live: boolean): boolean {
		return this._following && live;
	}
}

/** How far from the bottom still counts as "at the live edge" — a few pixels, to absorb sub-pixel rounding. */
const AT_BOTTOM_EPS = 4;

const atBottom = (el: HTMLElement): boolean => el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_EPS;

export class FollowController implements ReactiveController {
	private model = new FollowModel();
	private unwatch?: () => void;
	private listening?: HTMLElement;

	constructor(
		host: ReactiveControllerHost & Element,
		private scroller: () => HTMLElement | null,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		// Reaching the live edge (play / scrub-to-end publishes a null cursor) re-engages follow and jumps to the bottom.
		this.unwatch = timeCursor.subscribe((c) => {
			if (c === null) {
				this.model.onGoLive();
				this.scrollToBottom();
			}
		});
		this.attach();
	}

	// The scroll container may only exist after the first render (a shadow-DOM list), so (re)bind the scroll listener as it appears.
	hostUpdated(): void {
		this.attach();
	}

	hostDisconnected(): void {
		this.unwatch?.();
		this.listening?.removeEventListener("scroll", this.onScroll);
		this.listening = undefined;
	}

	/** Scroll to the live edge (the bottom) if the rules allow. Call after appending or rendering content. */
	stick(): void {
		if (this.model.shouldStick(timeCursor.get() === null)) this.scrollToBottom();
	}

	private attach(): void {
		const el = this.scroller();
		if (!el || el === this.listening) return;
		this.listening?.removeEventListener("scroll", this.onScroll);
		el.addEventListener("scroll", this.onScroll, { passive: true });
		this.listening = el;
	}

	private onScroll = (): void => {
		if (this.listening) this.model.onScrolled(atBottom(this.listening));
	};

	private scrollToBottom(): void {
		const el = this.listening ?? this.scroller();
		if (el) el.scrollTop = el.scrollHeight;
	}
}
