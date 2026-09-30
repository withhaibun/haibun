/**
 * Scroll an element into view within shu's own document. `scrollIntoView` scrolls the pages that embed shu too, which moves
 * what is under the person's pointer there: a click aimed at a control of the embedding page lands in shu's frame.
 */

export type TReveal = { block?: ScrollLogicalPosition; inline?: ScrollLogicalPosition; behavior?: ScrollBehavior };

/** How far a view scrolls to place the span [from, to] at `align` in the view [start, end], as `scrollIntoView` places it. */
export function alignedBy(from: number, to: number, start: number, end: number, align: ScrollLogicalPosition): number {
	if (align === "start") return from - start;
	if (align === "end") return to - end;
	if (align === "center") return (from + to - start - end) / 2;
	if ((from >= start && to <= end) || (from <= start && to >= end)) return 0;
	const fits = to - from <= end - start;
	return from < start === fits ? from - start : to - end;
}

/** The element a node is laid out in, across shadow roots and slots. */
const flatParent = (node: Element): Element | null => node.assignedSlot ?? node.parentElement ?? ((node.getRootNode() as Partial<ShadowRoot>).host || null);

const scrolls = (element: Element): boolean => {
	const { overflowX, overflowY } = getComputedStyle(element);
	return [overflowX, overflowY].some((overflow) => overflow !== "visible" && overflow !== "clip");
};

/** Scroll each of `element`'s scrolling ancestors, from the nearest out to its document's scroller, to place it as
 *  `scrollIntoView` places it. Each ancestor's scroll is measured before any scrolls, so a smooth scroll places it too. */
export function revealInDocument(element: Element, { block = "start", inline = "nearest", behavior = "auto" }: TReveal = {}): void {
	const root = element.ownerDocument.scrollingElement;
	let { top, bottom, left, right } = element.getBoundingClientRect();
	for (let scroller = flatParent(element); scroller; scroller = scroller === root ? null : flatParent(scroller)) {
		if (scroller !== root && !scrolls(scroller)) continue;
		const box = scroller.getBoundingClientRect();
		const view = scroller === root ? { top: 0, left: 0 } : { top: box.top + scroller.clientTop, left: box.left + scroller.clientLeft };
		const down = alignedBy(top, bottom, view.top, view.top + scroller.clientHeight, block);
		const across = alignedBy(left, right, view.left, view.left + scroller.clientWidth, inline);
		const scrolled = {
			top: clampedScroll(scroller.scrollTop, down, scroller.scrollHeight - scroller.clientHeight),
			left: clampedScroll(scroller.scrollLeft, across, scroller.scrollWidth - scroller.clientWidth),
		};
		scroller.scrollBy({ top: scrolled.top, left: scrolled.left, behavior });
		top -= scrolled.top;
		bottom -= scrolled.top;
		left -= scrolled.left;
		right -= scrolled.left;
	}
}

/** How far a scroller at `at` moves when asked to move `by`, since it stops at 0 and at `most`. */
const clampedScroll = (at: number, by: number, most: number): number => Math.min(Math.max(at + by, 0), Math.max(most, 0)) - at;
