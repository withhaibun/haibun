/**
 * The graph's JSON-LD context as a view reads it: the context document the page serves, read through the graph's context
 * port, narrowed to the type the view shows.
 */
import { CONTEXT_DOCUMENT } from "../../../domains/elements.js";
import { pageGraphContextDocument } from "../root.js";
import { typeContext } from "../derivations/jsonld-context-scope.js";

/** The served context narrowed to `type`. A served document without a context is refused, naming its address. */
export async function contextOfType(type: string): Promise<Record<string, unknown>> {
	const context = await pageGraphContextDocument().read(CONTEXT_DOCUMENT.namespace);
	if (context === undefined) throw new Error(`the context document at ${CONTEXT_DOCUMENT.namespace} lacks an @context`);
	return typeContext(context, type);
}
