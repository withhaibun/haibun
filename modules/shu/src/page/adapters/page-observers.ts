/** What the browser reports of the page: each script its Content-Security-Policy refuses, each long animation frame, an
 *  element's resizes and attribute changes, and the changes of a media query. */
import type { TPageObservers } from "../ports.js";
import type { TLongFrame } from "../../domains/blips.js";

/** The entry type of a long animation frame. */
const LONG_FRAME = "long-animation-frame";

/** Returns the observers of `page`. */
export function browserObservers(page: Window & typeof globalThis): TPageObservers {
	return {
		refusedScripts: (fn) => page.document.addEventListener("securitypolicyviolation", fn),
		longFrames: (fn) => {
			if (!page.PerformanceObserver?.supportedEntryTypes?.includes(LONG_FRAME)) return false;
			new page.PerformanceObserver((list) => list.getEntries().forEach((entry) => fn(entry as TLongFrame))).observe({ type: LONG_FRAME, buffered: true });
			return true;
		},
		resizes: (target, fn) => {
			const observer = new page.ResizeObserver(fn);
			observer.observe(target);
			return () => observer.disconnect();
		},
		attributes: (target, names, subtree, fn) => {
			const observer = new page.MutationObserver(fn);
			observer.observe(target, { attributes: true, subtree, attributeFilter: [...names] });
			return () => observer.disconnect();
		},
		mediaChanges: (query, fn) => {
			const media = page.matchMedia(query);
			media.addEventListener("change", fn);
			return () => media.removeEventListener("change", fn);
		},
	};
}
