/**
 * jsdom doesn't lay out, and doesn't ship the layout interfaces a component or a library it mounts calls: ResizeObserver
 * (the text annotator observes its container), a Range's client rects (the annotator paints highlights from them), and an
 * element's scrollBy (shu reveals an element within its document).
 * jsdom doesn't lay out an element, so these don't observe a change or measure geometry. What depends on real layout is covered
 * in a browser.
 */
class StubResizeObserver {
	observe(): void {
		/* an element doesn't resize in jsdom */
	}
	unobserve(): void {
		/* an element doesn't resize in jsdom */
	}
	disconnect(): void {
		/* an element doesn't resize in jsdom */
	}
}

/** Provide the layout interfaces jsdom lacks. An environment that has them keeps its own. */
export function provideLayout(): void {
	(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= StubResizeObserver;
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
	Element.prototype.scrollBy ??= () => undefined;
}
