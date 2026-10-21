/**
 * The formulas a graph model states, as TPTP axioms: each record's type as a unary predicate named by the type's persisted label,
 * and each literal property of a record and each edge between two records as a binary predicate, all ground atoms. A record
 * without a property or an edge still states its type, so a prover reads every record the graph shows and reasons over its
 * class. Each axiom names the record that asserted it, and states the record's line where the record is a step's, or the record
 * itself. A node that stands for the records a sample leaves out isn't a record, so it and its edges don't state a formula.
 * Each predicate is an entry of the predicate registry at its arity, and a predicate the registry doesn't hold is refused.
 */
import { constantOf, literalOf, nameOfText, type TFormula, type TTerm } from "@haibun/logic/derivations/formula.js";
import type { TStatedFormula } from "@haibun/logic/derivations/term-graph.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/actuality/domains/seq-path.js";
import { registeredPredicate } from "@haibun/core/lib/steps/derivations/predicate-registry.js";
import type { GraphModel, GraphNode } from "../domains/graph-model.js";

/** A literal property's value, which the model copies from a quad's object. Throws for a value that isn't text, a number or a
 *  boolean, which the model doesn't copy. */
function literalValue(subject: string, predicate: string, value: unknown): TTerm {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return literalOf(value);
	throw new Error(`the property ${predicate} of ${subject} holds a ${typeof value}, and a graph model holds text, a number or a boolean for a property`);
}

/** The haibun statement behind a record's axioms: the line a step's record states, or the record by its type and id. */
const statementOf = (node: GraphNode): string => {
	const line = node.properties[SEQ_PATH_FIELD.stepText];
	return typeof line === "string" ? line : `${node.type} ${node.id}`;
};

/** The axioms a graph model states, named by their kind and their position: n for a node's type, p for a property and e for an
 *  edge. Each predicate is named as the registry's `arities` hold it. */
export function graphAxioms({ nodes, edges }: GraphModel, arities: ReadonlyMap<string, number>): TStatedFormula[] {
	const records = new Map(nodes.filter((node) => node.isCluster !== true).map((node) => [node.id, node]));
	const stated = (node: GraphNode, predicate: string, ...objects: TTerm[]): Omit<TStatedFormula, "name" | "role"> => ({
		formula: { atom: nameOfText(registeredPredicate(arities, predicate, objects.length + 1)), args: [constantOf(node.id), ...objects] } satisfies TFormula,
		statement: statementOf(node),
		assertedBy: { persistedAs: node.type, id: node.id },
	});
	const named = (kind: string, axioms: Omit<TStatedFormula, "name" | "role">[]): TStatedFormula[] =>
		axioms.map((axiom, at) => ({ name: `${kind}${at + 1}`, role: "axiom", ...axiom }));
	return [
		...named(
			"n",
			[...records.values()].map((node) => stated(node, node.type)),
		),
		...named(
			"p",
			[...records.values()].flatMap((node) => Object.entries(node.properties).map(([predicate, value]) => stated(node, predicate, literalValue(node.id, predicate, value)))),
		),
		...named(
			"e",
			edges.flatMap((edge) => {
				const from = records.get(edge.from);
				return from === undefined || !records.has(edge.to) ? [] : [stated(from, edge.predicate, constantOf(edge.to))];
			}),
		),
	];
}
