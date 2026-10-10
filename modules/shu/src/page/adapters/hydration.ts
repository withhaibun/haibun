/** The page's hydration element, which a site writes into the page it serves and a record of actuality carries. */
import type { THydrationElement } from "../ports.js";

/** Returns the hydration element of `doc`, by its id `id`. */
export function documentHydration(doc: Document, id: string): THydrationElement {
	return {
		take: () => {
			const element = doc.getElementById(id);
			if (element === null || element.textContent === null || element.textContent === "") return undefined;
			const text = element.textContent;
			// The element holds a record of actuality as one string, which would stay in the document beside what the page
			// parses from it, so the page empties it once it reads it.
			element.textContent = "";
			return text;
		},
	};
}
