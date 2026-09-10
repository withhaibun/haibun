/**
 * Pure window derivation for shu-virtual-column, split out so it is unit-testable without lit-virtualizer (which needs
 * real layout and so is exercised in the browser e2e). The live-edge follow decision does NOT live here: it is the shared
 * FollowController (timeline-follow.ts); this module caches the geometry the component's wiring feeds it.
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

/** A row the cursor can sit on: its index in the column and the instant it records. */
export type TTimedRow = { index: number; timestamp: number };

/** The row that carries the time cursor: the last of `rows` (in index order) at or before it, or -1 for none (no
 *  cursor, or every row after it). The rows are what the column caches; one pass, no scan of the extent. */
export function currentRowIndex(rows: Iterable<TTimedRow>, cursor: number | null): number {
	if (cursor === null) return -1;
	let idx = -1;
	for (const { index, timestamp } of rows) if (timestamp <= cursor) idx = index;
	return idx;
}

/** Where the rail marks the moment being shown. It is always somewhere on the run: with no upper bound it is the newest
 *  row, and it moves as newer ones arrive; before the run began it is the top. That is not the same question as which
 *  row is current, no row is current before the first one, so a run with rows always has a mark, and only an empty
 *  one has none. */
export function cursorMark(currentIdx: number, rows: number, cursor: number | null): number {
	if (rows === 0) return -1;
	if (currentIdx >= 0) return currentIdx;
	return cursor === null ? rows - 1 : 0;
}

/** A row's time-cursor state: "future" (recorded after the cursor, dimmed), "current" (the cursor's row), or "" (past, or
 *  no cursor). The columns map these to the shared time-sync classes. */
export function rowTimeClass(timestamp: number, index: number, cursor: number | null, currentIdx: number): "future" | "current" | "" {
	if (cursor === null) return "";
	if (timestamp > cursor) return "future";
	return index === currentIdx ? "current" : "";
}
