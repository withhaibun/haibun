/**
 * Formulas projected once, for every surface that reads them: their ASCII TPTP text, which a prover such as Vampire or E reads
 * unchanged; each formula's Unicode tokens, its statement and the record that asserted it; a summary of its kinds; and the
 * term graph a graph view draws. The term graph's nodes are the formulas' parameters: each constant once, each variable of a
 * formula and each term a function applies within its formula, and a hub for each atom of an arity other than one or two. A
 * unary atom states its parameter's class, a binary atom or an equality is an edge labelled by its predicate, and a hub has an
 * edge to each argument labelled by its position. A variable, a function's term and a hub take their formula's name as their
 * kind, so each rule is a cluster of its own, and a constant takes its first class as its kind. Each node lists the formulas
 * that state it and each edge the formula that states it, so a selection of either selects the other. The projection requests
 * a hollow style for a variable, which an individual doesn't bind, and a badge on each cluster of a quantified rule.
 */
import type { TAssertedBy, TProjection } from "../domains/logic.js";
import { tptpOf, unicodeTokens, type TAnnotated, type TFormula, type TTerm } from "./formula.js";

/** A formula with the haibun statement it reads, and the record that asserted it where a record did. */
export type TStatedFormula = TAnnotated & { statement: string; assertedBy?: TAssertedBy };
type TTermNode = TProjection["nodes"][number];
type TTermEdge = TProjection["edges"][number];

/** The kind of a constant that a unary atom doesn't class. */
export const CONSTANT_KIND = "constant";
/** The badge on the cluster of a quantified rule. */
export const RULE_BADGE = "∀";
/** The negation an atom's edge or hub label states, as TPTP writes it. */
const NEGATED = "~";

/** Whether a formula is a rule: quantified, or an implication. A ground literal is an axiom of a fact. */
const isRule = (formula: TFormula): boolean => "quantifier" in formula || ("connective" in formula && (formula.connective === "=>" || formula.connective === "<="));

/** The key of an edge, from its ends and its label, by which a selection names it. */
export const edgeKey = (from: string, label: string, to: string): string => JSON.stringify([from, label, to]);

/** The names of the formulas that state any of the nodes or edges, by their ids and keys, in the projection's order. */
export function formulasStating({ formulas, nodes, edges }: TProjection, nodeIds: ReadonlySet<string>, edgeKeys: ReadonlySet<string>): string[] {
	const stating = new Set(nodes.filter(({ id }) => nodeIds.has(id)).flatMap((node) => node.formulas));
	for (const { from, label, to, formula } of edges) if (edgeKeys.has(edgeKey(from, label, to))) stating.add(formula);
	return formulas.filter(({ name }) => stating.has(name)).map(({ name }) => name);
}

/** The nodes and edges a formula states, by their ids and keys. */
export function statedBy({ nodes, edges }: TProjection, formula: string): { nodes: string[]; edges: string[] } {
	return {
		nodes: nodes.filter(({ formulas }) => formulas.includes(formula)).map(({ id }) => id),
		edges: edges.filter((edge) => edge.formula === formula).map(({ from, label, to }) => edgeKey(from, label, to)),
	};
}

/** The formulas projected: their text, summary, formulas, term graph and badged clusters. */
export function projected(stated: readonly TStatedFormula[]): TProjection {
	const nodes = new Map<string, TTermNode>();
	const edges: TTermEdge[] = [];
	const clusters: TProjection["clusters"] = [];
	const formulas = stated.map(({ formula, ...about }): TProjection["formulas"][number] => {
		const { name } = about;
		let hubs = 0;
		/** The node of a term: a constant shared by every formula, or a variable or a function's term of this formula. */
		const nodeOf = (term: TTerm): string => {
			const id = "variable" in term ? `${name}:${term.variable}` : term.args.length === 0 ? term.functor : `${name}:${term.functor}(${term.args.map(nodeOf).join(", ")})`;
			const held = nodes.get(id);
			if (held === undefined) {
				const ofFormula = "variable" in term || term.args.length > 0;
				nodes.set(id, {
					id,
					label: "variable" in term ? term.variable : term.functor,
					kind: ofFormula ? name : CONSTANT_KIND,
					classes: [],
					formulas: [name],
					...("variable" in term ? { hollow: true } : {}),
				});
				if ("functor" in term) term.args.forEach((arg, at) => edges.push({ from: id, to: nodeOf(arg), label: String(at + 1), formula: name }));
			} else if (!held.formulas.includes(name)) held.formulas.push(name);
			return id;
		};
		const stateAtom = (atom: Extract<TFormula, { atom: string }>, negated: boolean): void => {
			const label = negated ? `${NEGATED}${atom.atom}` : atom.atom;
			const [first, second] = atom.args;
			if (atom.args.length === 1 && first !== undefined && !negated) {
				const node = nodes.get(nodeOf(first));
				if (node === undefined) throw new Error(`the term graph doesn't hold the node of ${label}'s argument, which nodeOf holds`);
				if (!node.classes.includes(label)) node.classes.push(label);
				if (node.kind === CONSTANT_KIND && node.classes.length === 1) node.kind = label;
			} else if (atom.args.length === 2 && first !== undefined && second !== undefined) edges.push({ from: nodeOf(first), to: nodeOf(second), label, formula: name });
			else {
				hubs += 1;
				const id = `${name}#${hubs}`;
				nodes.set(id, { id, label, kind: name, classes: [], formulas: [name] });
				atom.args.forEach((arg, at) => edges.push({ from: id, to: nodeOf(arg), label: String(at + 1), formula: name }));
			}
		};
		const walk = (part: TFormula, negated: boolean): void => {
			if ("atom" in part) stateAtom(part, negated);
			else if ("equal" in part) edges.push({ from: nodeOf(part.left), to: nodeOf(part.right), label: part.equal !== negated ? "=" : "!=", formula: name });
			else if ("not" in part) walk(part.not, !negated);
			else if ("quantifier" in part) walk(part.body, negated);
			else {
				walk(part.left, negated);
				walk(part.right, negated);
			}
		};
		walk(formula, false);
		if ("quantifier" in formula && formula.quantifier === "!") clusters.push({ kind: name, badge: RULE_BADGE });
		const tokens = unicodeTokens(formula).map(({ text, role, term }) => (term === undefined ? { text, role } : { text, role, node: nodeOf(term) }));
		return { ...about, tptp: tptpOf({ ...about, formula }), tokens };
	});
	const rules = stated.filter(({ role, formula }) => role === "axiom" && isRule(formula)).length;
	const conjectures = stated.filter(({ role }) => role === "conjecture").length;
	const summary = { axioms: stated.length - rules - conjectures, rules, conjectures };
	return { text: formulas.map(({ tptp }) => tptp).join("\n"), summary, formulas, nodes: [...nodes.values()], edges, clusters };
}
