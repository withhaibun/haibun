/**
 * DOM visibility utilities
 */

/**
 * Check if an element is visible within its scrollable container.
 * Returns true if the element is at least **partially** visible (any overlap).
 * This is more lenient - we don't scroll if any part of the element is visible.
 *
 * @param element - The element to check
 * @param container - Optional container element (defaults to window viewport)
 * @returns true if element is at least partially visible
 */
export function isElementInView(element: Element, container?: Element | null): boolean {
	const rect = element.getBoundingClientRect();

	// Element has no size - consider it not visible
	if (rect.width === 0 || rect.height === 0) {
		return false;
	}

	if (container) {
		const containerRect = container.getBoundingClientRect();
		// Check for ANY overlap (partial visibility)
		return !(
			(
				rect.bottom < containerRect.top || // Element is above container
				rect.top > containerRect.bottom || // Element is below container
				rect.right < containerRect.left || // Element is left of container
				rect.left > containerRect.right
			) // Element is right of container
		);
	}

	// Check against window viewport - is ANY part visible?
	const viewHeight = window.innerHeight || document.documentElement.clientHeight;
	const viewWidth = window.innerWidth || document.documentElement.clientWidth;

	return !(
		(
			rect.bottom < 0 || // Element is above viewport
			rect.top > viewHeight || // Element is below viewport
			rect.right < 0 || // Element is left of viewport
			rect.left > viewWidth
		) // Element is right of viewport
	);
}

/**
 * Scroll element into view only if it's not already visible.
 * This prevents disruptive scrolling when user is viewing the current area.
 *
 * @param element - The element to scroll to
 * @param container - Optional container to check visibility against
 * @param options - ScrollIntoViewOptions
 */
export function scrollIntoViewIfNeeded(element: Element | null, container?: Element | null, options?: ScrollIntoViewOptions): void {
	if (!element) return;

	if (!isElementInView(element, container)) {
		element.scrollIntoView(options ?? { behavior: "auto", block: "center" });
	}
}
