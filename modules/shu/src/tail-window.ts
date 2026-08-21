/**
 * The window a view that tails the live edge keeps over the shared event log (events-snapshot), counted in events.
 *
 * While pinned to the live edge the view holds the newest page of events, where a page is the one window-size setting
 * every windowed view shares (shu-window-size, default 500 rows): memory stays flat however long the run is. When the
 * reader scrolls back to the top of what is held, the view widens by one more page, and so on back to the start of the
 * run; when the reader returns to the live edge the view narrows to one page again, and the log evicts the rest. The
 * count is what the view decides; the log turns it into the span of time those events cover (`registerTail`), reading
 * from its own persisted store first and the server only for what it lacks.
 */
import { getWindowSize } from "./components/shu-window-size.js";

/** How close to the top of the held events a reader has to scroll before the next page is asked for, as a fraction of a page. */
const WIDEN_MARGIN = 0.25;

/** The bookkeeping of one tailing view: whether it follows, and how many pages back it has been widened. Each method
 *  says whether the view should re-register its window now. */
export class TailWindow {
	#following: boolean;
	#pages = 1;

	constructor({ following = false }: { following?: boolean } = {}) {
		this.#following = following;
	}

	get following(): boolean {
		return this.#following;
	}

	/** How many events this view wants held: its pages of the shared window size; every event at its levels once the
	 *  reader has asked for the start of the run. */
	count(): number {
		return this.#pages === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : this.#pages * getWindowSize();
	}

	/** The reader asked for the START of the run (the rail's top glyph): hold everything at this view's levels from the
	 *  start to the live edge, rather than one page more. True: re-register. Returning to the live edge narrows as ever. */
	toStart(): boolean {
		if (this.#pages === Number.POSITIVE_INFINITY) return false;
		this.#pages = Number.POSITIVE_INFINITY;
		this.#following = false; // the reader is going to the start, not to the live edge
		return true;
	}

	/** The follow state flipped. Returning to the live edge narrows back to one page (true: re-register, which evicts the
	 *  rest); leaving it changes nothing by itself — the widening comes from scrolling toward the top. */
	follow(following: boolean): boolean {
		if (following === this.#following) return false;
		this.#following = following;
		if (following && this.#pages !== 1) {
			this.#pages = 1;
			return true;
		}
		return false;
	}

	/** Live events arrived while following: `held` is how many the view now holds. Past its pages by a slack of a quarter
	 *  page, the view re-registers (true), which narrows back to its pages and evicts the oldest — in chunks, not per event. */
	slide(held: number): boolean {
		return this.#following && held > this.count() * (1 + WIDEN_MARGIN);
	}

	/** The reader's visible window moved: `first` is the first visible row of `held` rows. Near the top of what is held,
	 *  and not already at the start of the run, the view widens by one page (true: re-register). */
	widenIfNear(first: number, held: number, atStart: boolean): boolean {
		if (this.#following || atStart || held === 0) return false;
		if (first > getWindowSize() * WIDEN_MARGIN) return false;
		this.#pages++;
		return true;
	}
}
