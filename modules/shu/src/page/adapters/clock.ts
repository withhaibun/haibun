/** The page's clock: the browser's time, its timers and its animation frames. */
import type { TClock } from "../ports.js";

/** Returns the clock of `page`. */
export function browserClock(page: Window): TClock {
	return {
		now: () => Date.now(),
		elapsed: () => page.performance.now(),
		after: (ms, fn) => {
			const timer = page.setTimeout(fn, ms);
			return () => page.clearTimeout(timer);
		},
		frame: (fn) => {
			const frame = page.requestAnimationFrame(fn);
			return () => page.cancelAnimationFrame(frame);
		},
	};
}
