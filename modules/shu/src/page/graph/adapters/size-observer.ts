/**
 * The size observer: what an element's size changes report. A `ResizeObserver` on the element fires when its box
 * changes; observing returns a cancel that stops the observation. The view that owns the element reads this, so it
 * performs no observation itself.
 */
import type { TSizeObserver } from "../ports.js";

/** Returns the size observer, which watches an element's box and reports its changes. */
export function sizeObserver(): TSizeObserver {
	return {
		observe(target, onResize) {
			const observer = new ResizeObserver(onResize);
			observer.observe(target);
			return () => observer.disconnect();
		},
	};
}
