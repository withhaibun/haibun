/**
 * The predicates a statement read takes: each relation whose range is an IRI.
 */
import { LinkRelations } from "../../domains/resources.js";

/** Returns every rel in LinkRelations whose range is an IRI and that isn't abstract. A reader picks a predicate from
 *  this list and doesn't guess one. */
export function statementPredicates(): string[] {
	return Object.values(LinkRelations)
		.filter((entry) => entry.range === "iri" && !(entry as { abstract?: boolean }).abstract)
		.map((entry) => entry.rel);
}
