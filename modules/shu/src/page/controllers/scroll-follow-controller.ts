/**
 * ScrollFollowController: the one live-edge follow behaviour every scrolling view holds.
 *
 * Every view applies the same rules:
 *  - The view scrolls to its end only while it shows the live edge and the reader hasn't scrolled away from it.
 *  - Reader input pauses following, and the view holds the place it was showing.
 *  - Reaching the end, or the page going live, resumes following and returns the view to the page's cursor.
 *  - A paused view states what arrived after the reader's place, and shows a control that returns the reader to the end.
 *
 * The controller holds the follow decision and the timeline wiring. The host holds how its own scroller reports its
 * end, because that differs: a plain container reads pixel geometry, and a virtualizer reports through its window
 * reaching the last row. The host translates whichever applies into `setAtBottom`.
 *
 * A jump to the end returns whether the scroller holds the row at the end. A virtualizer takes in a changed row count
 * on its own update, after the host's, so a jump issued between the two targets a row the virtualizer doesn't hold
 * yet, and the virtualizer ignores it. The controller marks that jump pending, and the host calls `rowsArrived` once
 * its scroller holds the new rows. The pending jump is issued again then, where the rules still allow it.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { timeCursor } from "../root.js";
import { TimelineViewController } from "./timeline-view-controller.js";

export class ScrollFollowController implements ReactiveController {
	#host: ReactiveControllerHost;
	#jumpToEdge: () => boolean;
	/** Set while the last jump targeted a row the scroller didn't hold yet, cleared by the next jump or by the reader pausing. */
	#edgePending = false;
	/** The reader's intent to follow: true until they scroll away, true again when they return or the page goes live. */
	#following = true;
	/** What the host holds after the reader's place, read rather than counted, so a record removed while they read
	 *  doesn't leave a count behind. A host that doesn't state one doesn't offer the reader a place to return to. */
	#arrivedAfter: () => number;
	/** Where the reader is on the timeline as they stop following, which the view holds from then on. */
	#placeNow: () => number | null;
	#unwatch?: () => void;

	/** `jumpToEdge` scrolls the host to its end and returns whether the scroller held the row there. `view` is the place
	 *  this host shows. A host that doesn't state a view holds one of its own, which tracks the page. */
	constructor(host: ReactiveControllerHost, jumpToEdge: () => boolean, opts: { view?: TimelineViewController; arrivedAfter?: () => number; placeNow?: () => number | null } = {}) {
		this.#host = host;
		this.#jumpToEdge = jumpToEdge;
		this.view = opts.view ?? new TimelineViewController(host);
		this.#arrivedAfter = opts.arrivedAfter ?? (() => 0);
		// A host that doesn't state a place holds the page's cursor, which is what a view tracking the page already shows.
		this.#placeNow = opts.placeNow ?? (() => this.view.cursor);
		host.addController(this);
	}

	readonly view: TimelineViewController;

	hostConnected(): void {
		// The page reaching the live edge, which playing and scrubbing to the end do, returns every view to it.
		this.#unwatch = timeCursor.subscribe((cursor) => {
			if (cursor === null) this.resume();
		});
	}

	hostDisconnected(): void {
		this.#unwatch?.();
		this.#unwatch = undefined;
	}

	get isFollowing(): boolean {
		return this.#following;
	}

	/** How many entries arrived after the reader's place. A view at the end states zero. */
	get arrived(): number {
		return this.#following ? 0 : this.#arrivedAfter();
	}

	/** The host reports the reader reaching the end (`true`, resume) or scrolling away from it (`false`, pause), read
	 *  however that host's scroller reports it. */
	setAtBottom(atBottom: boolean): void {
		if (atBottom) return this.#followAgain();
		this.pause();
	}

	/** The reader reads where they are: following stops and the view holds the place it shows. */
	private pause(): void {
		if (!this.#following) return;
		this.#following = false;
		this.#edgePending = false;
		this.view.hold(this.#placeNow());
		this.#host.requestUpdate();
	}

	/** Scroll to the end and follow from there. The control a paused view shows calls this, and so does the page reaching the live edge. */
	resume(): void {
		this.#followAgain();
		this.#jump();
	}

	/** The host reports that its scroller holds new rows. A jump the scroller ignored before it held them is issued again. */
	rowsArrived(): void {
		if (!this.#edgePending) return;
		this.#edgePending = false;
		this.stick();
	}

	#jump(): void {
		this.#edgePending = !this.#jumpToEdge();
	}

	/** Follow from where the reader is, which is the end: the view reads the page's cursor. The view doesn't scroll,
	 *  since the reader is already there. */
	#followAgain(): void {
		if (this.#following && this.view.tracking) return;
		this.#following = true;
		this.view.track();
		this.#host.requestUpdate();
	}

	/** Scroll to the end where the rules allow it. Called after a row is added: a reader reading where they are keeps
	 *  their place, and reads what the host holds after it. */
	stick(): void {
		if (this.#following && this.view.atLiveEdge) return this.#jump();
		this.#host.requestUpdate();
	}
}
