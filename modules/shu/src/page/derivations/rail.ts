/**
 * The geometry of a column's scroll rail, the rail's scale over actuality's span, a virtual column's window, and the time
 * ranges a windowed source holds.
 *
 * The rail places its thumb and its marks by row index: the total row count, the visible window (the first row and how
 * many are visible) and each mark's index. An index is exact at any row height and at millions of rows. The thumb's size
 * is the viewport's share of the column, which the column measures in pixels where rows differ in height. A count of
 * rendered rows changes with the content on screen, and a thumb sized from it resizes and moves every mark during a
 * scroll. `shu-scrollbar.ts` renders the rail from these functions.
 */
import type { TEventMarkerStyle } from "./status-mark.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { clamp } from "./layout.js";

/** A mark on the scroll rail: a row of the whole column (an annotation, a failed step, a feature's start) at its index,
 *  drawn as a glyph, so a reader sees its place in the column and moves to it from anywhere. `icon` and `color` are the
 *  row's event mark. */
export type TScrollMarker = TEventMarkerStyle & { index: number; id: string; label?: string };

/** The visible window: the first row on screen and how many rows are visible. */
export type TWindow = { first: number; visible: number };

/** The thumb's least height in pixels. A thumb over millions of rows stays this tall, so a pointer can drag it. */
const MIN_THUMB_PX = 16;

/** How close in pixels two marks are drawn before they merge into one mark with a count. */
const MARK_MERGE_PX = 10;

/** Returns the thumb's height on a `railPx` rail for a viewport that shows `fraction` (0 to 1) of the column, at least
 *  `MIN_THUMB_PX`. The thumb's travel and the marks' inset derive from this height. */
export function thumbHeightPx(fraction: number, railPx: number): number {
	if (railPx <= 0) return 0;
	return Math.min(railPx, Math.max(MIN_THUMB_PX, Math.round(Math.min(1, Math.max(0, fraction)) * railPx)));
}

/** Returns how far the window is through the column by row index: 0 at the first window, 1 at the last, and 0 where every
 *  row is in the window. */
export function scrollFraction(total: number, win: TWindow): number {
	const maxFirst = Math.max(0, total - win.visible);
	return maxFirst === 0 ? 0 : Math.min(1, Math.max(0, win.first / maxFirst));
}

/** The scale of the position a rail states to assistive technology, from its first window to its last. */
export const RAIL_POSITION_MAX = 100;

/** Returns the position a rail states to assistive technology: the scroll fraction on a scale of 0 to `RAIL_POSITION_MAX`,
 *  rounded down, so the rail states its maximum only where the window holds the column's last row. */
export const railPosition = (total: number, win: TWindow): number => Math.floor(scrollFraction(total, win) * RAIL_POSITION_MAX);

/** The steps the viewport's share of the column is quantised to: finer than a pixel on any rail that draws, so the thumb
 *  resizes only where the resize is visible. */
const SHARE_STEPS = 512;

/** Returns the viewport's share of a column `total` pixels long that shows `visible` of them, quantised, so a revision of a
 *  height estimate too small to move the thumb a whole pixel leaves the share the same; undefined where the column is empty. */
export const viewportShare = (visible: number, total: number): number | undefined => (total > 0 ? Math.round((visible / total) * SHARE_STEPS) / SHARE_STEPS : undefined);

/** Returns the thumb's top on a `railPx` rail: the scroll fraction by row index, across the travel the thumb's height
 *  leaves. */
export function thumbTopPx(total: number, win: TWindow, railPx: number, heightPx: number): number {
	if (total <= 0 || railPx <= 0) return 0;
	return Math.round(scrollFraction(total, win) * (railPx - heightPx));
}

/** Returns the first visible row that a pointer at `pointerPx` from the top of a `railPx` rail selects, within the first
 *  and the last window. The pointer holds the thumb at its centre, so half the thumb's height is subtracted. */
export function firstAtPointer(total: number, visible: number, pointerPx: number, railPx: number, heightPx: number): number {
	if (total <= 0 || railPx <= 0) return 0;
	const travel = Math.max(1, railPx - heightPx);
	const frac = Math.min(1, Math.max(0, (pointerPx - heightPx / 2) / travel));
	return Math.round(frac * Math.max(0, total - visible));
}

/** Half a mark's glyph. The marks' scale is inset by it, so the first and last marks are drawn whole at the rail's ends. */
export const MARK_INSET_PX = 8;

/**
 * Returns the centre on a `railPx` rail of the mark at row `index`: the row's place across the whole rail.
 *
 * The scale reads only the rows and the rail. A scale inset by half the thumb drew every mark of a short log in the
 * middle of the rail, where a third of the log filled the viewport, and left the rail's ends without a mark. A row's
 * place doesn't depend on what the viewport shows.
 */
export function markerTopPx(index: number, total: number, railPx: number): number {
	if (total <= 1 || railPx <= 0) return 0;
	const frac = Math.min(index, total - 1) / (total - 1);
	return Math.round(MARK_INSET_PX + frac * Math.max(0, railPx - MARK_INSET_PX * 2));
}

/** Returns the marks with each run of marks closer than `MARK_MERGE_PX` merged into its topmost row with a `count`, so a
 *  dense run of rows shows one glyph. The marks may arrive in any order. */
export function clusterMarkers(markers: TScrollMarker[], total: number, railPx: number): Array<TScrollMarker & { topPx: number; count: number }> {
	// Marks sort by pixel and then by index, so a merged mark is the topmost row of its run in every order of the input.
	const placed = markers.map((m) => ({ ...m, topPx: markerTopPx(m.index, total, railPx) })).sort((a, b) => a.topPx - b.topPx || a.index - b.index);
	const out: Array<TScrollMarker & { topPx: number; count: number }> = [];
	for (const m of placed) {
		const last = out[out.length - 1];
		if (last && m.topPx - last.topPx < MARK_MERGE_PX) last.count += 1;
		else out.push({ ...m, count: 1 });
	}
	return out;
}

/** How near a mark a press lands to select the mark: about the height of its glyph. */
export const MARK_SNAP_PX = 8;

/** Returns the row a pointer at `pointerPx` selects on the marks' scale, the inverse of `markerTopPx`. Every row has a
 *  place on this scale. The thumb's scale places windows, and the last `visible` rows don't start a window. */
export function indexAtMarkerPx(pointerPx: number, total: number, railPx: number): number {
	if (total <= 1 || railPx <= 0) return 0;
	const travel = Math.max(1, railPx - MARK_INSET_PX * 2);
	const frac = Math.min(1, Math.max(0, (pointerPx - MARK_INSET_PX) / travel));
	return Math.round(frac * (total - 1));
}

/**
 * Returns the row a press on the rail selects: the mark it lands on, or the row at its height.
 *
 * Both rows are on the marks' scale, so a press selects the same row whether a mark is drawn there or not. On the
 * thumb's scale the last `visible` rows wouldn't have a place, since a window doesn't start at them, and half a thumb
 * of travel at each end would map to one row. The column's scroller determines what to show from the row.
 *
 * A mark doesn't take a press of its own. A mark on a narrow rail that took one would take most presses near it.
 */
export function pressTarget(pressedPx: number, marks: ReadonlyArray<{ index: number; topPx: number }>, total: number, railPx: number): number {
	// The rail's head and foot select actuality's first and last rows. A mark is drawn at each end, and a mark that took
	// these presses would leave the first and last rows without a place where a mark is near them.
	if (pressedPx <= MARK_INSET_PX) return 0;
	if (pressedPx >= railPx - MARK_INSET_PX) return Math.max(0, total - 1);
	let nearest: { index: number; away: number } | null = null;
	for (const m of marks) {
		const away = Math.abs(m.topPx - pressedPx);
		if (away <= MARK_SNAP_PX && (!nearest || away < nearest.away)) nearest = { index: m.index, away };
	}
	return nearest ? nearest.index : indexAtMarkerPx(pressedPx, total, railPx);
}

/** Actuality's span: the instants of its first and last records. */
export type TActualitySpan = { first: number; last: number };

/** The rail's focus: the moment a reader reads, and the window of records the page holds around it. */
export type TActualityFocus = { at: number; from: number; to: number };

/**
 * The share of the rail that the window the page holds takes. The rest places what actuality recorded outside the window,
 * at both ends.
 *
 * A rail is a few hundred pixels, and actuality spans any length of time, so one linear scale places a year at a day per
 * pixel. The rail's scale is focused instead. The window maps linearly onto the middle share, so a press near the focus
 * selects the moment under it. Each end places what is outside the window by the logarithm of its distance, so a failure
 * a year before has a place, further out than one an hour before. Where the window covers all of actuality, the whole
 * rail maps linearly.
 */
export const FOCUS_SHARE = 0.6;

/** Returns `n` as a fraction of the rail. */
const onRail = (n: number): number => clamp(n, 0, 1);

/** Returns the shares of the two ends outside the window, by the logarithm of the time each places. An end that doesn't
 *  place a record takes zero, and the other end takes the whole share. */
function ends(span: TActualitySpan, focus: TActualityFocus): { before: number; after: number; beforeLen: number; afterLen: number } {
	const beforeLen = Math.max(0, focus.from - span.first);
	const afterLen = Math.max(0, span.last - focus.to);
	const weight = Math.log1p(beforeLen) + Math.log1p(afterLen);
	const outside = 1 - FOCUS_SHARE;
	if (weight === 0) return { before: 0, after: 0, beforeLen, afterLen };
	return { before: (outside * Math.log1p(beforeLen)) / weight, after: (outside * Math.log1p(afterLen)) / weight, beforeLen, afterLen };
}

/** Whether the window the page holds covers all of actuality's span. */
const holdsItAll = (span: TActualitySpan, focus: TActualityFocus): boolean => focus.from <= span.first && focus.to >= span.last;

/** Returns a moment's place on the rail, as a fraction from actuality's first record to its last. */
export function railAt(moment: number, span: TActualitySpan, focus: TActualityFocus): number {
	const reach = span.last - span.first;
	if (reach <= 0) return 0;
	if (holdsItAll(span, focus)) return onRail((moment - span.first) / reach);
	const { before, after, beforeLen, afterLen } = ends(span, focus);
	if (moment <= focus.from) return beforeLen === 0 ? 0 : onRail(before * (1 - Math.log1p(focus.from - moment) / Math.log1p(beforeLen)));
	if (moment >= focus.to) return afterLen === 0 ? 1 : onRail(before + FOCUS_SHARE + after * (Math.log1p(moment - focus.to) / Math.log1p(afterLen)));
	const held = focus.to - focus.from;
	return onRail(before + (held <= 0 ? 0 : (FOCUS_SHARE * (moment - focus.from)) / held));
}

/** Returns the moment at a fraction of the rail, the inverse of `railAt`. A press on the rail reads actuality at it. */
export function momentAt(fraction: number, span: TActualitySpan, focus: TActualityFocus): number {
	const reach = span.last - span.first;
	if (reach <= 0) return span.first;
	const f = onRail(fraction);
	if (holdsItAll(span, focus)) return span.first + f * reach;
	const { before, after, beforeLen, afterLen } = ends(span, focus);
	if (f <= before) return beforeLen === 0 ? span.first : focus.from - Math.expm1(((before - f) / before) * Math.log1p(beforeLen));
	if (f >= before + FOCUS_SHARE) return afterLen === 0 ? span.last : focus.to + Math.expm1(((f - before - FOCUS_SHARE) / after) * Math.log1p(afterLen));
	return focus.from + ((f - before) / FOCUS_SHARE) * (focus.to - focus.from);
}

/** Returns the visible window from a virtualizer's first and last visible indices. An empty viewport (`last` before
 *  `first`) has zero visible rows, so the column doesn't request a range and the thumb collapses. `shu-virtual-column.ts`
 *  renders through it, and `ScrollFollowController` determines whether the column follows the last row. */
export function visibleWindow(first: number, last: number): TWindow {
	return { first, visible: Math.max(0, last - first + 1) };
}

/** Returns the last row a window shows: the last visible row, and each row after it that the source reports as empty. An
 *  empty row doesn't take room, so a window that shows a row shows the empty rows between it and the next row with content. */
export function lastShownRow(last: number, count: number, rowSize: (index: number) => number | undefined): number {
	let shown = last;
	while (shown + 1 < count && rowSize(shown + 1) === 0) shown++;
	return shown;
}

/** The rows between the window's end and the last row above which a move to the last row jumps to it. At or below it, the
 *  move steps `CONVERGE_STEP` rows at a time. */
export const COARSE_GAP = 60;

export const CONVERGE_STEP = 12;

/** The passes a view takes to converge on a row, after which it gives up on a row the content can never reach. */
export const MAX_CONVERGE = 40;

/** A following view's convergence on its last row: the row count it chases, and the jumps it has issued for that count since
 *  it last showed the last row. */
export type TConvergence = { rows: number; passes: number };

/** Returns a following view's convergence after a report of its window, and whether it jumps to its last row again. Showing
 *  the last row starts the passes over, so a row that grows after, moving the last row out of view without a change of count,
 *  starts a new convergence. Short of the last row, it jumps while its passes for this row count are under MAX_CONVERGE. */
export function converged(convergence: TConvergence, rows: number, atEnd: boolean): { convergence: TConvergence; jump: boolean } {
	const passes = atEnd || convergence.rows !== rows ? 0 : convergence.passes;
	const jump = !atEnd && passes < MAX_CONVERGE;
	return { convergence: { rows, passes: jump ? passes + 1 : passes }, jump };
}

/**
 * Returns the row a move to the last row targets, for a virtualizer that places unmeasured rows by estimated heights.
 * A far jump lands near the end and not at it. The same far target again doesn't move the window: the rows between the
 * window and the target don't render, so the estimate doesn't change. The move jumps to the last row while the window is
 * far from it, and then steps a few rows at a time, each target next to measured rows, whose offset is exact.
 */
export function convergeTarget(window: TWindow, count: number): number {
	const windowEnd = window.first + window.visible;
	return count - windowEnd > COARSE_GAP ? count - 1 : Math.min(count - 1, windowEnd + CONVERGE_STEP);
}

/** A row the time cursor can mark: its index in the column and the instant it records. */
export type TTimedRow = { index: number; timestamp: number };

/** The rows a time cursor reads, in index order, with the earliest instant of each row and every row after it. A column
 *  places a step's row by its path, so its rows aren't always in the order of their instants; the earliest instant from a
 *  row on never decreases, which is what a binary search reads. */
export type TTimedRows = { indices: readonly number[]; earliestFrom: readonly number[] };

/** Returns the rows a time cursor reads, built in one pass from the last row back. */
export function timedRows(rows: readonly TTimedRow[]): TTimedRows {
	const earliestFrom = new Array<number>(rows.length);
	let earliest = Number.POSITIVE_INFINITY;
	for (let i = rows.length - 1; i >= 0; i--) {
		earliest = Math.min(earliest, itemAt(rows, i).timestamp);
		earliestFrom[i] = earliest;
	}
	return { indices: rows.map((row) => row.index), earliestFrom };
}

/** Returns the row of the time cursor: the last row, in index order, at or before the cursor, found by a binary search of
 *  the earliest instants. Returns -1 without a cursor, or where every row is after it. */
export function rowAtCursor({ indices, earliestFrom }: TTimedRows, cursor: number | null): number {
	if (cursor === null) return -1;
	// The first position whose earliest instant is after the cursor: every row from it on is after the cursor, and the row
	// before it is at or before the cursor, or it would not be.
	let low = 0;
	let high = earliestFrom.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (itemAt(earliestFrom, mid) <= cursor) low = mid + 1;
		else high = mid;
	}
	return low === 0 ? -1 : itemAt(indices, low - 1);
}

/** Returns the row where the rail marks the moment shown. Without a cursor it is the newest row, which changes as rows
 *  arrive. Before actuality's first row it is the first row. A column with rows always has a mark, and an empty column
 *  doesn't (-1). The current row differs: a row isn't current before the first one. */
export function cursorMark(currentIdx: number, rows: number, cursor: number | null): number {
	if (rows === 0) return -1;
	if (currentIdx >= 0) return currentIdx;
	return cursor === null ? rows - 1 : 0;
}

/** Returns a row's state against the time cursor: "future" (recorded after the cursor, dimmed), "current" (the cursor's
 *  row), or "" (before the cursor, or without one). A column maps each to its time-sync class. */
export function rowTimeClass(timestamp: number, index: number, cursor: number | null, currentIdx: number): "future" | "current" | "" {
	if (cursor === null) return "";
	if (timestamp > cursor) return "future";
	return index === currentIdx ? "current" : "";
}

/**
 * A range of time in epoch milliseconds, from `from` to `to`, which includes `from` and excludes `to`. `to` is Infinity at
 * the newest edge, the only open range. A windowed source holds the union of the ranges its readers request, reads the
 * gaps, and drops the ranges a reader doesn't request.
 */
export type Range = { from: number; to: number };

/** Returns the ranges sorted by `from`, with overlapping and adjacent ranges joined and empty ranges dropped. */
export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
	const out: Range[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
		else out.push({ from: r.from, to: r.to });
	}
	return out;
}

/** Returns the parts of `a` that `b` doesn't cover: the gaps (requested and not held) and the ranges to drop (held and
 *  not requested). */
export function subtractRanges(a: Range[], b: Range[]): Range[] {
	const holes = mergeRanges(b);
	const out: Range[] = [];
	for (const r of mergeRanges(a)) {
		let cursor = r.from;
		for (const h of holes) {
			if (h.to <= cursor) continue;
			// The holes are sorted, so each later hole starts after this range.
			if (h.from >= r.to) break;
			if (h.from > cursor) out.push({ from: cursor, to: h.from });
			cursor = h.to;
			if (cursor >= r.to) break;
		}
		if (cursor < r.to) out.push({ from: cursor, to: r.to });
	}
	return out;
}

/** Returns the overlap of `a` and `b`: the part of a windowed read, or of a live event's route, that both cover. */
export function intersectRanges(a: Range[], b: Range[]): Range[] {
	const out: Range[] = [];
	for (const x of mergeRanges(a))
		for (const y of mergeRanges(b)) {
			const from = Math.max(x.from, y.from);
			const to = Math.min(x.to, y.to);
			if (from < to) out.push({ from, to });
		}
	return mergeRanges(out);
}

/** Whether `t` is in one of the ranges. A range at the newest edge includes every later instant. */
export function rangeContains(ranges: Range[], t: number): boolean {
	return ranges.some((r) => t >= r.from && t < r.to);
}
