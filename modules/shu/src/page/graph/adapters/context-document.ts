/**
 * The context document: what the graph view reads of its JSON-LD context. The usual way a JSON-LD context is fetched is
 * by URL, and this reads the document the page serves at that URL and returns its `@context`. The caller scopes it to
 * the type it shows.
 */
import type { TGraphContextDocument } from "../ports.js";

/** Returns the context document, which reads the served JSON-LD context by address. */
export function contextDocument(): TGraphContextDocument {
	return {
		async read(address: string) {
			const raw: unknown = await (await fetch(address)).json();
			if (!raw || typeof raw !== "object" || !("@context" in raw)) return undefined;
			const context = raw["@context"];
			if (typeof context !== "object" || context === null) return undefined;
			// A JSON-LD context is a free-form map of prefix to term; no schema validates it.
			return context as Record<string, unknown>;
		},
	};
}
