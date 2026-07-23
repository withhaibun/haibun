/**
 * The geometry glue for the annotated file's annotation glyph rail: a `shu-scrollbar` that sits fixed beside a scrolling
 * document and marks where each annotation is, so a reader jumps between notes in a long file without scrolling for them.
 * Unlike a row list, the annotated body is continuous prose scrolled by an ancestor (the entity column's overflow), so
 * the rail works in that ancestor's PIXEL space: total = its scrollHeight, window = its scrollTop + clientHeight, and each
 * mark sits at its annotation's pixel offset down the content. These helpers are the DOM-reading, testable middle; the
 * component owns mounting and the per-annotation offset (which needs the live text range).
 */
import type { TScrollMarker, TWindow } from "./scrollbar-model.js";

const scrolls = (el: HTMLElement): boolean => {
	const oy = getComputedStyle(el).overflowY;
	return oy === "auto" || oy === "scroll" || oy === "overlay";
};

const hostOf = (node: Node): Node | null => {
	const root = node.getRootNode();
	return root instanceof ShadowRoot ? root.host : null;
};

/** The nearest scrollable ancestor of `el`, crossing shadow boundaries — the annotated body is light DOM inside a host
 *  shadow whose `:host` is the scroller. Null when nothing between here and the document scrolls. */
export function findScrollAncestor(el: Element): HTMLElement | null {
	let node: Node | null = el.parentNode ?? hostOf(el);
	while (node) {
		if (node instanceof HTMLElement && scrolls(node)) return node;
		node = node.parentNode ?? hostOf(node);
	}
	return null;
}

/** The rail's total (scrollable height) and window (what is on screen), read from the scroll container. */
export function railTotalAndWindow(scrollEl: HTMLElement): { total: number; window: TWindow } {
	return { total: scrollEl.scrollHeight, window: { first: Math.round(scrollEl.scrollTop), visible: scrollEl.clientHeight } };
}

/** One rail mark per located annotation, at its pixel offset down the scroll content. Pure over the located set the
 *  component computes (an annotation absent from the current text has no offset and is left off the rail). */
export function railMarks(located: ReadonlyArray<{ commentId: string; offset: number; label: string }>, color: string): TScrollMarker[] {
	return located.map((a) => ({ index: Math.round(a.offset), id: a.commentId, icon: "📝", color, label: a.label }));
}
