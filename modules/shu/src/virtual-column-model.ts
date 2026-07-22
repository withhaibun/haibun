/**
 * Pure decision logic for shu-virtual-column, split out so it is unit-testable without lit-virtualizer (which needs real
 * layout and so is exercised in the browser e2e). The element wires these to the virtualizer's events; the correctness
 * of the window derivation and the live-follow decision lives here.
 */
import type { TWindow } from "./scrollbar-model.js";

/** The visible window from a virtualizer's first/last visible indices. An empty viewport (last < first) clamps to zero
 *  visible rows, so `ensureRange` is skipped and the rail thumb collapses rather than inverting. */
export function visibleWindow(first: number, last: number): TWindow {
	return { first, visible: Math.max(0, last - first + 1) };
}

/** Whether a live append should stick to the end: following is on, the reader is at the live time edge (no cursor
 *  scrubbed into the past), and the window covered the end BEFORE the append — compared against the pre-append count, so
 *  a reader parked at the bottom keeps tailing while one scrolled up does not get yanked down. */
export function shouldFollow(follow: boolean, window: TWindow, preAppendCount: number, timeCursor: number | null): boolean {
	return follow && timeCursor === null && window.first + window.visible >= preAppendCount;
}
