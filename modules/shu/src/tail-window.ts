/**
 * The window a view that tails the live edge registers with the shared event log (events-snapshot).
 *
 * While the reader is pinned to the live edge, the view wants only a bounded tail below the newest event, so memory stays
 * flat however long the run is. When the reader scrolls back, it wants the full history, so nothing is out of reach; the
 * log's server pages that history in from the run's disk log as far back as the reader goes. The tail's lower bound moves
 * as the live edge moves, but only in coarse steps: a reconcile per event would thrash, and re-registering is what evicts
 * the events that fell below it. Every view that tails (the monitor's log, the document) shares this one rule.
 */
import type { Range } from "./ranges.js";
import { FULL_WINDOW, newestEventTime } from "./events-snapshot.js";

export const TAIL_MS = 10 * 60_000;

/** The window for a tailing view: a bounded tail below the newest event while following, else the full history. `from`
 *  clamps at 0, so a run shorter than the tail is just the whole log (no eviction). Pure, so the decision is unit-tested
 *  without a virtualizer. */
export function tailWindow(following: boolean, newest: number, tailMs: number = TAIL_MS): Range[] {
	if (!following) return [FULL_WINDOW];
	return [{ from: Math.max(0, newest - tailMs), to: Number.POSITIVE_INFINITY }];
}

/** The bookkeeping of one tailing view: whether it follows, and where its tail's lower bound was last registered. Each
 *  method says whether the view should re-register its window now. A view that follows by default starts following, so
 *  its FIRST registration is already the tail: otherwise every boot would fetch the whole history and then evict it. */
export class TailWindow {
	#following: boolean;
	#registeredFrom = 0;
	readonly #tailMs: number;

	constructor({ following = false, tailMs = TAIL_MS }: { following?: boolean; tailMs?: number } = {}) {
		this.#following = following;
		this.#tailMs = tailMs;
	}

	get following(): boolean {
		return this.#following;
	}

	/** The span this view wants right now. `newest` is the newest event this view has seen; before it has seen any (the
	 *  first registration at boot), the tail is anchored at the run's newest event as the shared log or the server knows
	 *  it, never at a clock: the events' own times are the only times that place a window. So the first fetch is a tail
	 *  of the run rather than the whole run, and a run from another day (a saved report) is still found. */
	async ranges(newest: number): Promise<Range[]> {
		if (!this.#following) return tailWindow(false, newest, this.#tailMs);
		const anchor = newest || (await newestEventTime());
		const ranges = tailWindow(true, anchor, this.#tailMs);
		this.#registeredFrom = ranges[0].from;
		return ranges;
	}

	/** The follow state flipped (the reader reached the live edge, or scrolled back from it). True when the window should
	 *  be re-registered: narrowed to the tail, which evicts the old, or widened to full, which fetches history back. */
	follow(following: boolean, newest: number): boolean {
		if (following === this.#following) return false;
		this.#following = following;
		this.#registeredFrom = following ? Math.max(0, newest - this.#tailMs) : 0;
		return true;
	}

	/** The live edge moved. True when the tail's lower bound has moved a full step since it was last registered, so the
	 *  view should re-register (evicting what fell below); false while following is off or the step is not yet due. */
	slide(newest: number): boolean {
		if (!this.#following) return false;
		const from = Math.max(0, newest - this.#tailMs);
		if (from - this.#registeredFrom < this.#tailMs / 4) return false; // a quarter of the tail per step: coarse, so eviction runs in chunks
		this.#registeredFrom = from;
		return true;
	}
}
