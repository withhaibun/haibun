/**
 * The geometry glue for the annotated file's annotation glyph rail: a `shu-scrollbar` that sits fixed beside a scrolling
 * document and marks where each annotation is, so a reader jumps between notes in a long file without scrolling for them.
 * Unlike a row list, the annotated body is continuous prose scrolled in its own region (native scrollbar hidden), so
 * the rail works in that region's PIXEL space: total = its scrollHeight, window = its scrollTop + clientHeight, and each
 * mark sits at its annotation's pixel offset down the content. These helpers are the DOM-reading, testable middle; the
 * component owns mounting and the per-annotation offset (which needs the live text range).
 */
import type { TScrollMarker, TWindow } from "./scrollbar-model.js";
import { ANNOTATION_GLYPH } from "./consts.js";

/** The rail's total (scrollable height) and window (what is on screen), read from the scroll container. */
export function railTotalAndWindow(scrollEl: HTMLElement): { total: number; window: TWindow } {
	return { total: scrollEl.scrollHeight, window: { first: Math.round(scrollEl.scrollTop), visible: scrollEl.clientHeight } };
}

/** One rail mark per located annotation, at its pixel offset down the scroll content. Pure over the located set the
 *  component computes (an annotation absent from the current text has no offset and is left off the rail). */
export function railMarks(located: ReadonlyArray<{ commentId: string; offset: number; label: string }>, color: string): TScrollMarker[] {
	return located.map((a) => ({ index: Math.round(a.offset), id: a.commentId, icon: ANNOTATION_GLYPH, color, label: a.label }));
}
