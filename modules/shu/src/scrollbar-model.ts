/**
 * Pure geometry and marker model for the custom scroll rail. POSITION is INDEX space (rows): the rail knows the total
 * row count, the visible window (first index + how many), and markers at absolute indices, which is exact regardless of
 * row height, reliable at millions of rows, and reusable by both the DOM rail and a future 3D chip-mesh rail. SIZE is the
 * viewport's share of the column, which the host measures in pixels where rows differ in height: a rendered row count
 * swings with the content on screen, which would resize the thumb and shift every mark as a reader scrolls.
 * Every function is pure and unit-tested; the element wiring lives in shu-scrollbar.ts.
 */
import type { TEventMarkerStyle } from "./event-marker.js";

/** A mark on the scroll rail: a significant row somewhere in the full data set (an annotation, a failed step, a feature
 *  boundary) at its absolute `index`, drawn as an emoji glyph so a reader sees where it sits across the whole column and
 *  can jump to it even when that row is far outside the rendered window. `icon`/`color` reuse the event-marker vocabulary. */
export type TScrollMarker = TEventMarkerStyle & { index: number; id: string; label?: string };

/** The visible window: the first row on screen and how many rows are visible. */
export type TWindow = { first: number; visible: number };

/** The thumb's height on a `railPx` rail for a viewport showing `fraction` (0..1) of the column, never below
 *  `minThumbPx` so it stays grabbable at millions of rows. The ONE definition of the thumb's size: its travel and the
 *  marker inset are both derived from it, so they can never disagree. */
export function thumbHeightPx(fraction: number, railPx: number, minThumbPx = 16): number {
	if (railPx <= 0) return 0;
	return Math.min(railPx, Math.max(minThumbPx, Math.round(Math.min(1, Math.max(0, fraction)) * railPx)));
}

/** The thumb's top on a `railPx` rail: the scroll fraction in INDEX space (exact at any row height) across the travel
 *  the thumb's own height leaves. */
export function thumbTopPx(total: number, win: TWindow, railPx: number, heightPx: number): number {
	if (total <= 0 || railPx <= 0) return 0;
	const maxFirst = Math.max(0, total - win.visible);
	const scrollFrac = maxFirst === 0 ? 0 : Math.min(1, Math.max(0, win.first / maxFirst));
	return Math.round(scrollFrac * (railPx - heightPx));
}

/** Inverse of thumb positioning: the first-visible row index a pointer at `pointerPx` down a `railPx` rail selects,
 *  clamped so a drag reaches the very first and very last window. `pointerPx` is measured from the rail top; the thumb's
 *  half-height is subtracted so the pointer grabs the thumb centre. */
export function firstAtPointer(total: number, visible: number, pointerPx: number, railPx: number, heightPx: number): number {
	if (total <= 0 || railPx <= 0) return 0;
	const travel = Math.max(1, railPx - heightPx);
	const frac = Math.min(1, Math.max(0, (pointerPx - heightPx / 2) / travel));
	return Math.round(frac * Math.max(0, total - visible));
}

/** Half a mark's glyph: the only inset the mark scale carries, so the first and last are drawn whole rather than
 *  clipped by the rail's ends. */
export const MARK_INSET_PX = 8;

/**
 * The centre pixel on a `railPx` rail for a mark at absolute `index`: the row's position spread across the WHOLE rail.
 *
 * The scale is the rows and the rail, and nothing else. It used to be inset by half the THUMB, so that a press on a
 * mark would land inside the window the thumb would then show, but a press picks a row directly now, and the scroller
 * works out what to show from it. The inset only did harm: a viewport holding a third of a short log makes a thumb a
 * third of the rail, which squeezed every mark into the middle two thirds and left the ends of the rail dead. What the
 * viewport happens to be showing is no business of where a row sits in the run.
 */
export function markerTopPx(index: number, total: number, railPx: number): number {
	if (total <= 1 || railPx <= 0) return 0;
	const frac = Math.min(index, total - 1) / (total - 1);
	return Math.round(MARK_INSET_PX + frac * Math.max(0, railPx - MARK_INSET_PX * 2));
}

/** Collapse markers that land within `mergePx` of each other into one representative carrying a `count`, so a dense run
 *  of rows shows one glyph rather than a pile. Input need not be sorted; the surviving mark of a cluster is its topmost row. */
export function clusterMarkers(markers: TScrollMarker[], total: number, railPx: number, mergePx = 10): Array<TScrollMarker & { topPx: number; count: number }> {
	// Sort by pixel, breaking ties by index, so a dense cluster is deterministic and its surviving mark is the topmost row.
	const placed = markers.map((m) => ({ ...m, topPx: markerTopPx(m.index, total, railPx) })).sort((a, b) => a.topPx - b.topPx || a.index - b.index);
	const out: Array<TScrollMarker & { topPx: number; count: number }> = [];
	for (const m of placed) {
		const last = out[out.length - 1];
		if (last && m.topPx - last.topPx < mergePx) last.count += 1;
		else out.push({ ...m, count: 1 });
	}
	return out;
}

/** How near a mark a press must land to be taken as meaning that mark: about the height of the glyph drawn there. */
export const MARK_SNAP_PX = 8;

/** The row a pointer at `pointerPx` picks out, on the scale the marks are DRAWN at: the inverse of markerTopPx.
 *
 *  Every row is reachable, which is what picking needs: the rail's other scale spans the WINDOWS there are rather than
 *  the rows, so its last `visible` rows have no window that starts at them and cannot be pointed at at all. */
export function indexAtMarkerPx(pointerPx: number, total: number, railPx: number): number {
	if (total <= 1 || railPx <= 0) return 0;
	const travel = Math.max(1, railPx - MARK_INSET_PX * 2);
	const frac = Math.min(1, Math.max(0, (pointerPx - MARK_INSET_PX) / travel));
	return Math.round(frac * (total - 1));
}

/**
 * The ROW a press on the rail means: the mark it landed on if it landed on one, else the row at that height.
 *
 * Both answers are on the marks' own scale, so a press means the same row whether or not a mark happens to be drawn
 * there. Answering on the scale a press SCROLLS by instead would leave the last `visible` rows unreachable: no window
 * starts at them, and flatten the ends of the rail, where half a thumb of travel maps to one row. What to
 * scroll to is a separate question, and the scroller answers it from this row.
 *
 * Marks take no press of their own: drawn across the middle of a narrow rail, a mark that did would take most
 * attempts to point anywhere near it.
 */
export function pressTarget(pressedPx: number, marks: ReadonlyArray<{ index: number; topPx: number }>, total: number, railPx: number): number {
	// The head and foot of the rail are the start and end of the run, whatever is drawn there. A mark now sits at each
	// end, and letting it take these presses would mean the first and last rows could only be reached when nothing
	// happened to be marked near them: the ends going missing again, by a different route.
	if (pressedPx <= MARK_INSET_PX) return 0;
	if (pressedPx >= railPx - MARK_INSET_PX) return Math.max(0, total - 1);
	let nearest: { index: number; away: number } | null = null;
	for (const m of marks) {
		const away = Math.abs(m.topPx - pressedPx);
		if (away <= MARK_SNAP_PX && (!nearest || away < nearest.away)) nearest = { index: m.index, away };
	}
	return nearest ? nearest.index : indexAtMarkerPx(pressedPx, total, railPx);
}

/** A position glyph for a count of `n` rows: thousands-separated up to a million, then compacted to `1.2M` so it fits
 *  the narrow rail (the top readout shows the first visible row's ordinal, the bottom shows the total). */
export function formatCount(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return n.toLocaleString("en-US");
	// Round to one decimal FIRST, then pick the branch on the rounded value, so 9.96M does not print "10.0M" while 10M
	// prints "10M" (the >=10 test must see the same rounded number toFixed produces).
	const m = Math.round(n / 100_000) / 10;
	return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
}
