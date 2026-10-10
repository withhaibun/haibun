/**
 * These helpers compute a rail's geometry in a scroll container's pixel coordinates. The annotated file's annotation
 * glyph rail is a `shu-scrollbar` fixed beside a scrolling document. It marks the position of each annotation, so a
 * reader moves between notes in a long file without scrolling to find them. The annotated body is continuous prose that
 * scrolls in its own region with the native scrollbar hidden. The rail's total is that region's scrollHeight. The rail's
 * window starts at the region's scrollTop and spans its clientHeight. Each mark is at its annotation's pixel offset in
 * the content. `shu-virtual-column` reads its scroller's total and window through `railTotalAndWindow` too. `shu-annotated-body`
 * mounts the rail and computes each annotation's offset from the live text range.
 */
import type { TScrollMarker, TWindow } from "./page/derivations/rail.js";
import { ANNOTATION_GLYPH } from "./domains/elements.js";

/** Reads the rail's total (scrollable height) and window (the visible part) from the scroll container. */
export function railTotalAndWindow(scrollEl: HTMLElement): { total: number; window: TWindow } {
	return { total: scrollEl.scrollHeight, window: { first: Math.round(scrollEl.scrollTop), visible: scrollEl.clientHeight } };
}

/** Returns one rail mark per located annotation, at its pixel offset in the scroll content. It is pure over the located
 *  annotations the component computes. An annotation absent from the current text doesn't have an offset, so `located`
 *  doesn't include it. */
export function railMarks(located: ReadonlyArray<{ commentId: string; offset: number; label: string }>, color: string): TScrollMarker[] {
	return located.map((a) => ({ index: Math.round(a.offset), id: a.commentId, icon: ANNOTATION_GLYPH, color, label: a.label }));
}
