/**
 * jsdom does no layout, and ships none of the layout interfaces a component or a library it mounts calls: ResizeObserver
 * (the text annotator observes its container) and a Range's client rects (the annotator paints highlights from them).
 * Nothing is laid out in jsdom, so these observe nothing and measure no geometry. What depends on real layout is covered
 * in a browser.
 */
class StubResizeObserver {
	observe(): void {
		/* nothing resizes in jsdom */
	}
	unobserve(): void {
		/* nothing resizes in jsdom */
	}
	disconnect(): void {
		/* nothing resizes in jsdom */
	}
}

/** Provide the layout interfaces jsdom lacks. An environment that has them keeps its own. */
export function provideLayout(): void {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= StubResizeObserver;
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}
