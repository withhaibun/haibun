/**
 * Pure geometry and marker model for the custom scroll rail, in INDEX space (rows), never pixels: the rail knows the
 * total row count, the visible window (first index + how many), and a set of markers at absolute indices. Keeping it in
 * index space makes it exact regardless of variable row heights (the virtualizer owns pixel layout and reports the
 * visible index range), robust at millions of rows, and reusable by both the DOM rail and a future 3D chip-mesh rail.
 * Every function is pure and unit-tested; the element wiring lives in shu-scrollbar.ts.
 */
import type { TEventMarkerStyle } from "./event-marker.js";

/** A mark on the scroll rail: a significant row somewhere in the full data set (an annotation, a failed step, a feature
 *  boundary) at its absolute `index`, drawn as an emoji glyph so a reader sees where it sits across the whole column and
 *  can jump to it even when that row is far outside the rendered window. `icon`/`color` reuse the event-marker vocabulary. */
export type TScrollMarker = TEventMarkerStyle & { index: number; id: string; label?: string };

/** The visible window: the first row on screen and how many rows are visible. */
export type TWindow = { first: number; visible: number };

/** Thumb geometry for a `railPx` rail showing `visible` of `total` rows with `first` at the top: the thumb is sized to
 *  the visible fraction (never below `minThumbPx`, so it stays grabbable at millions) and positioned by the scroll
 *  fraction. Returns pixels within the rail. */
export function thumbGeometry(total: number, win: TWindow, railPx: number, minThumbPx = 16): { topPx: number; heightPx: number } {
	if (total <= 0 || railPx <= 0) return { topPx: 0, heightPx: Math.max(0, railPx) };
	const heightPx = Math.min(railPx, Math.max(minThumbPx, Math.round(Math.min(1, win.visible / total) * railPx)));
	const maxFirst = Math.max(0, total - win.visible);
	const scrollFrac = maxFirst === 0 ? 0 : Math.min(1, Math.max(0, win.first / maxFirst));
	return { topPx: Math.round(scrollFrac * (railPx - heightPx)), heightPx };
}

/** Inverse of thumb positioning: the first-visible row index a pointer at `pointerPx` down a `railPx` rail selects,
 *  clamped so a drag reaches the very first and very last window. `pointerPx` is measured from the rail top; the thumb's
 *  half-height is subtracted so the pointer grabs the thumb centre. */
export function firstAtPointer(total: number, visible: number, pointerPx: number, railPx: number, minThumbPx = 16): number {
	if (total <= 0 || railPx <= 0) return 0;
	const heightPx = Math.min(railPx, Math.max(minThumbPx, Math.round(Math.min(1, visible / total) * railPx)));
	const travel = Math.max(1, railPx - heightPx);
	const frac = Math.min(1, Math.max(0, (pointerPx - heightPx / 2) / travel));
	return Math.round(frac * Math.max(0, total - visible));
}

/** The centre pixel on a `railPx` rail for a marker at absolute `index` of `total` rows: where its glyph sits, so a
 *  reader sees the mark at the same proportional position the thumb would reach it. */
export function markerTopPx(index: number, total: number, railPx: number): number {
	if (total <= 1 || railPx <= 0) return 0;
	return Math.round((Math.min(index, total - 1) / (total - 1)) * railPx);
}

/** When many markers fall on nearly the same pixel (a dense cluster of annotations in a huge column), collapse those
 *  within `mergePx` of each other into one representative mark carrying a `count`, so the rail shows a readable set of
 *  glyphs rather than an unreadable smear. Input markers need not be sorted. */
export function clusterMarkers(markers: TScrollMarker[], total: number, railPx: number, mergePx = 10): Array<TScrollMarker & { topPx: number; count: number }> {
	const placed = markers.map((m) => ({ ...m, topPx: markerTopPx(m.index, total, railPx) })).sort((a, b) => a.topPx - b.topPx);
	const out: Array<TScrollMarker & { topPx: number; count: number }> = [];
	for (const m of placed) {
		const last = out[out.length - 1];
		if (last && m.topPx - last.topPx < mergePx) last.count += 1;
		else out.push({ ...m, count: 1 });
	}
	return out;
}

/** A position glyph for a count of `n` rows: thousands-separated up to a million, then compacted to `1.2M` so it fits
 *  the narrow rail (the top readout shows the first visible row's ordinal, the bottom shows the total). */
export function formatCount(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return n.toLocaleString("en-US");
	const m = n / 1_000_000;
	return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
}
