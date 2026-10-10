/** The page's location: its hash, its address without the hash, and each arrival at a new hash. */
import type { TLocation } from "../ports.js";

/** Returns the location of `page`. */
export function browserLocation(page: Window): TLocation {
	return {
		hash: () => page.location.hash,
		replaceHash: (hash) => {
			try {
				page.history.replaceState(null, "", hash);
			} catch (err) {
				// A record opened from `file://` refuses a write of its address in some browsers. Its views read the hash the page
				// holds, so the refusal leaves the address as it arrived.
				if (!(err instanceof DOMException && err.name === "SecurityError")) throw err;
			}
		},
		onHashArrival: (fn) => {
			page.addEventListener("hashchange", fn);
			return () => page.removeEventListener("hashchange", fn);
		},
		address: () => page.location.origin + page.location.pathname + page.location.search,
	};
}
