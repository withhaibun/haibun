/**
 * TimelineViewController: a view's own place on the run's timeline.
 *
 * The page has one cursor, `timeCursor`: null at the live edge, or an instant the reader scrubbed to. A view tracks
 * that cursor, so playing and scrubbing the run move the view with the page. A view whose reader scrolls away from the
 * live edge holds the instant it was showing, and keeps it while the rest of the page moves, until the reader returns
 * to the live edge.
 *
 * A view that states a `name` writes its held instant to the address under that name, so a reload opens the view where
 * the reader was reading. A tracking view writes nothing, since the page's cursor is the page's to state.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { timeCursor } from "../signals.js";
import { hashParam, mergeHashParams, onHashChanged } from "../view-hash.js";

/** A reader's place: the instant the view shows, null at the live edge, and whether the page's cursor moves it. */
export type TTimelineView = { cursor: number | null; tracking: boolean };

export class TimelineViewController implements ReactiveController {
	#host: ReactiveControllerHost;
	#name: string | undefined;
	#onMove: (() => void) | undefined;
	/** The instant this view holds, where it holds one. A tracking view holds none and reads the page's cursor. */
	#held: number | null = null;
	#tracking = true;
	#unwatch: Array<() => void> = [];

	/** `name` is the address key a held place is written under. A view that states none holds a place for as long as it
	 *  is mounted and states it nowhere. */
	constructor(host: ReactiveControllerHost, opts: { name?: string; onMove?: () => void } = {}) {
		this.#host = host;
		this.#name = opts.name;
		this.#onMove = opts.onMove;
		host.addController(this);
	}

	hostConnected(): void {
		this.#readAddress();
		this.#unwatch.push(timeCursor.subscribe(() => this.#moved()));
		if (this.#name) this.#unwatch.push(onHashChanged(() => this.#readAddress()));
	}

	hostDisconnected(): void {
		for (const stop of this.#unwatch) stop();
		this.#unwatch = [];
	}

	/** The state this view shows. */
	get state(): TTimelineView {
		return { cursor: this.cursor, tracking: this.#tracking };
	}

	/** The instant this view shows: its own where it holds one, else the page's cursor. */
	get cursor(): number | null {
		return this.#tracking ? timeCursor.get() : this.#held;
	}

	/** Whether this view shows the live edge, which is what a following view sticks to. */
	get atLiveEdge(): boolean {
		return this.cursor === null;
	}

	get tracking(): boolean {
		return this.#tracking;
	}

	/** Hold the place this view shows, which is where the reader left the live edge. */
	hold(at: number | null = this.cursor): void {
		if (!this.#tracking && this.#held === at) return;
		this.#tracking = false;
		this.#held = at;
		this.#stateAddress();
		this.#moved();
	}

	/** Read the page's cursor again, which is what returning to the live edge does. */
	track(): void {
		if (this.#tracking) return;
		this.#tracking = true;
		this.#held = null;
		this.#stateAddress();
		this.#moved();
	}

	/** Whether a record made at this instant is one this view shows: every record at or before the place it holds. */
	shows(at: number | undefined): boolean {
		const cursor = this.cursor;
		return cursor === null || at === undefined || at <= cursor;
	}

	#moved(): void {
		this.#onMove?.();
		this.#host.requestUpdate();
	}

	#stateAddress(): void {
		if (!this.#name) return;
		mergeHashParams({ [this.#name]: this.#tracking || this.#held === null ? "" : String(this.#held) });
	}

	/** The place the address states, where it states one this view isn't already showing. */
	#readAddress(): void {
		if (!this.#name) return;
		const stated = hashParam(this.#name);
		const at = stated ? Number(stated) : null;
		if (at !== null && Number.isFinite(at)) {
			if (this.#tracking || this.#held !== at) {
				this.#tracking = false;
				this.#held = at;
				this.#moved();
			}
			return;
		}
		if (!this.#tracking) {
			this.#tracking = true;
			this.#held = null;
			this.#moved();
		}
	}
}
