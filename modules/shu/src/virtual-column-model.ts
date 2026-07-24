/**
 * Pure window derivation for shu-virtual-column, split out so it is unit-testable without lit-virtualizer (which needs
 * real layout and so is exercised in the browser e2e). The live-edge follow decision does NOT live here: it is the shared
 * FollowController (timeline-follow.ts); this module holds the geometry the component's wiring feeds it.
 */
import type { TWindow } from "./scrollbar-model.js";

/** The visible window from a virtualizer's first/last visible indices. An empty viewport (last < first) clamps to zero
 *  visible rows, so `ensureRange` is skipped and the rail thumb collapses rather than inverting. */
export function visibleWindow(first: number, last: number): TWindow {
	return { first, visible: Math.max(0, last - first + 1) };
}

/** Gap (rows between the window's end and the last row) above which the jump-to-edge goes coarse; at or below it, the
 *  approach steps so every target's offset is backed by real measurements and the window provably advances. */
export const COARSE_GAP = 60;
export const CONVERGE_STEP = 12;

/** The row a jump-to-live-edge should target, for a virtualizer that positions by height ESTIMATES of unmeasured rows.
 *  One far jump lands near, not at, the end, and re-issuing the same far target deadlocks: the rows between window and
 *  target never render, so the estimate never improves and the window never moves. Hence two gaits: a COARSE jump to the
 *  last row while far (speed; accuracy is irrelevant mid-flight), then STEPS of a few rows, each targeting a row adjacent
 *  to already-measured content, whose offset is exact. */
export function convergeTarget(window: TWindow, count: number): number {
	const windowEnd = window.first + window.visible;
	return count - windowEnd > COARSE_GAP ? count - 1 : Math.min(count - 1, windowEnd + CONVERGE_STEP);
}
