/**
 * ScrollFollowController: the one live-edge follow behaviour every scrolling view holds.
 *
 * The rules are the same in every view, so a reader learns them once:
 *  - The view scrolls to its end only while it shows the live edge and the reader hasn't scrolled away from it.
 *  - Reader input pauses following, and the view holds the place it was showing.
 *  - Reaching the end, or the page going live, resumes following and returns the view to the page's cursor.
 *  - A paused view counts what arrived after the reader's place, so the view offers to return them to the end.
 *
 * The controller holds the follow decision and the timeline wiring. The host holds how its own scroller reports its
 * end, because that differs: a plain container reads pixel geometry, and a virtualizer reports through its window
 * reaching the last row. The host translates whichever applies into `setAtBottom`.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { timeCursor } from "../signals.js";
import { TimelineViewController } from "./timeline-view-controller.js";

/** How many pixels above its end a followed view may sit and still count as at the live edge: the height-estimate
 *  overshoot below the last row is tens of pixels, a stalled follow is hundreds. One contract, shared by every host
 *  that reports its end and by the control that asserts it. */
export const FOLLOW_EDGE_SLACK_PX = 200;

export class ScrollFollowController implements ReactiveController {
	#host: ReactiveControllerHost;
	#jumpToEdge: () => void;
	/** The reader's intent to follow: true until they scroll away, true again when they return or the page goes live. */
	#following = true;
	/** What arrived while the reader was away from the end. */
	#arrived = 0;
	#unwatch: Array<() => void> = [];

	/** `view` is the place this host shows. A host that states none holds a view of its own, which tracks the page. */
	constructor(host: ReactiveControllerHost, jumpToEdge: () => void, readonly view: TimelineViewController = new TimelineViewController(host)) {
		this.#host = host;
		this.#jumpToEdge = jumpToEdge;
		host.addController(this);
	}

	hostConnected(): void {
		// The page reaching the live edge, which playing and scrubbing to the end do, returns every view to it.
		this.#unwatch.push(
			timeCursor.subscribe((cursor) => {
				if (cursor === null) this.resume();
			}),
		);
	}

	hostDisconnected(): void {
		for (const stop of this.#unwatch) stop();
		this.#unwatch = [];
	}

	get isFollowing(): boolean {
		return this.#following;
	}

	/** What arrived after the reader's place, which a paused view offers to take them to. */
	get arrived(): number {
		return this.#arrived;
	}

	/** The host reports the reader reaching the end (`true`, resume) or scrolling away from it (`false`, pause), read
	 *  however that host's scroller reports it. */
	setAtBottom(atBottom: boolean): void {
		if (atBottom) return this.#followAgain();
		this.pause();
	}

	/** The reader reads where they are: following stops and the view holds the place it shows. */
	pause(): void {
		if (!this.#following) return;
		this.#following = false;
		this.view.hold();
		this.#host.requestUpdate();
	}

	/** Take the reader to the end and follow from there: the press a paused view offers, and the page going live. */
	resume(): void {
		this.#followAgain();
		this.#jumpToEdge();
	}

	/** Follow from where the reader is, which is the end: the view reads the page's cursor, and what arrived is counted
	 *  from here. The view doesn't scroll, since the reader is already there. */
	#followAgain(): void {
		const moved = !this.#following || !this.view.tracking || this.#arrived > 0;
		this.#following = true;
		this.#arrived = 0;
		this.view.track();
		if (moved) this.#host.requestUpdate();
	}

	/** Scroll to the end where the rules allow it, and count what arrived where they don't. Called after a row is added. */
	stick(added = 1): void {
		if (this.#following && this.view.atLiveEdge) return this.#jumpToEdge();
		if (added <= 0) return;
		this.#arrived += added;
		this.#host.requestUpdate();
	}
}
