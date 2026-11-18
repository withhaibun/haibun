/**
 * The context document: what the graph view reads of its JSON-LD context. The usual way a JSON-LD context is fetched is
 * by URL, and this reads the document the page serves at that URL and returns its `@context`. The caller scopes it to
 * the type it shows.
 */
import { z } from "zod";
import type { TGraphContextDocument } from "../ports.js";

/** A served JSON-LD document whose context is a map. */
const ContextDocumentSchema = z.object({ "@context": z.record(z.string(), z.unknown()) });

/** Returns the context document, which reads the served JSON-LD context by address. */
export function contextDocument(): TGraphContextDocument {
	return {
		async read(address: string) {
			// A JSON-LD context is a map of prefix to term, whose terms the graph view reads as it scopes the context.
			const read = ContextDocumentSchema.safeParse(await (await fetch(address)).json());
			return read.success ? read.data["@context"] : undefined;
		},
	};
}
