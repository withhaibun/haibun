/**
 * Formulas projected once: the term graph's constants, variables, functions' terms, hubs and classes, the formulas each node and
 * edge names for a selection, each formula's Unicode tokens with their nodes, the summary of kinds and the badged rule clusters,
 * and a term graph equal to the one the parse of the emitted text yields.
 */
import { describe, expect, it } from "vitest";
import { constantOf, literalOf, parseFormula, unicodeOf, type TAnnotated, type TFormula, type TTerm } from "./formula.js";
import { CONSTANT_KIND, RULE_BADGE, projected, type TStatedFormula } from "./term-graph.js";

const [A, B] = [constantOf("a@test.com"), constantOf("b@test.com")];
const X1 = { variable: "X1" };
const atom = (predicate: string, ...args: TTerm[]): TFormula => ({ atom: predicate, args });
const RECORD = { persistedAs: "Email", id: "a@test.com" };
const STATED: TStatedFormula[] = [
	{ name: "n1", role: "axiom", formula: atom("Email", A), statement: "Email a@test.com", assertedBy: RECORD },
	{ name: "n2", role: "axiom", formula: atom("Email", B), statement: "Email b@test.com", assertedBy: { persistedAs: "Email", id: "b@test.com" } },
	{ name: "p1", role: "axiom", formula: atom("subject", A, literalOf("Roadmap")), statement: "Email a@test.com", assertedBy: RECORD },
	{ name: "e1", role: "axiom", formula: atom("inReplyTo", B, A), statement: "Email b@test.com", assertedBy: { persistedAs: "Email", id: "b@test.com" } },
	{ name: "h1", role: "axiom", formula: atom("sent", A, B, literalOf("2025-03-01")), statement: "a message sent between two people" },
	{ name: "h2", role: "axiom", formula: atom("ready"), statement: "Ready" },
	{ name: "q1", role: "axiom", formula: { not: { equal: true, left: A, right: B } }, statement: "two emails" },
	{
		name: "r1",
		role: "axiom",
		formula: {
			quantifier: "!",
			variables: ["X1"],
			body: { connective: "=>", left: atom("Email", X1), right: { atom: "replied", args: [{ functor: "Kitchen-reply", args: [X1] }] } },
		},
		statement: "reply to {email: email}",
	},
	{ name: "goal", role: "conjecture", formula: { quantifier: "?", variables: ["X1"], body: atom("inReplyTo", X1, A) }, statement: "resolve reply" },
];

describe("formulas projected once", () => {
	const projection = projected(STATED);
	const node = (id: string) => projection.nodes.find((one) => one.id === id);

	it("draws each constant once, classed by its unary atoms and kinded by its first class", () => {
		expect(node("a@test.com")).toEqual({ id: "a@test.com", label: "a@test.com", kind: "Email", classes: ["Email"], formulas: ["n1", "p1", "e1", "h1", "q1", "goal"] });
		expect(node('"Roadmap"')).toEqual({ id: '"Roadmap"', label: '"Roadmap"', kind: CONSTANT_KIND, classes: [], formulas: ["p1"] });
	});

	it("draws each variable of a rule, and the term a function applies, hollow where it is a variable, as its rule's cluster", () => {
		expect(node("r1:X1")).toEqual({ id: "r1:X1", label: "X1", kind: "r1", classes: ["Email"], formulas: ["r1"], hollow: true });
		expect(node("goal:X1")).toMatchObject({ kind: "goal", hollow: true });
		expect(node("r1:Kitchen-reply(r1:X1)")).toEqual({ id: "r1:Kitchen-reply(r1:X1)", label: "Kitchen-reply", kind: "r1", classes: ["replied"], formulas: ["r1"] });
		expect(projection.clusters, "the universal rule's cluster carries the badge, and the existential conjecture's doesn't").toEqual([{ kind: "r1", badge: RULE_BADGE }]);
	});

	it("labels an edge by its predicate, and a hub's edges by position, each naming the formula that states it", () => {
		expect(projection.edges).toEqual([
			{ from: "a@test.com", to: '"Roadmap"', label: "subject", formula: "p1" },
			{ from: "b@test.com", to: "a@test.com", label: "inReplyTo", formula: "e1" },
			{ from: "h1#1", to: "a@test.com", label: "1", formula: "h1" },
			{ from: "h1#1", to: "b@test.com", label: "2", formula: "h1" },
			{ from: "h1#1", to: '"2025-03-01"', label: "3", formula: "h1" },
			{ from: "a@test.com", to: "b@test.com", label: "!=", formula: "q1" },
			{ from: "r1:Kitchen-reply(r1:X1)", to: "r1:X1", label: "1", formula: "r1" },
			{ from: "goal:X1", to: "a@test.com", label: "inReplyTo", formula: "goal" },
		]);
		expect(node("h1#1")).toEqual({ id: "h1#1", label: "sent", kind: "h1", classes: [], formulas: ["h1"] });
		expect(node("h2#1"), "a proposition is a hub without an edge").toEqual({ id: "h2#1", label: "ready", kind: "h2", classes: [], formulas: ["h2"] });
	});

	it("tokens each formula in Unicode notation, each term's token naming its node, beside its ASCII TPTP, statement and record", () => {
		const [p1] = projection.formulas.filter(({ name }) => name === "p1");
		expect(p1).toEqual({
			name: "p1",
			role: "axiom",
			statement: "Email a@test.com",
			assertedBy: RECORD,
			tptp: "fof(p1, axiom, subject('a@test.com', '\"Roadmap\"')).",
			tokens: [
				{ text: "subject", role: "predicate" },
				{ text: "(", role: "symbol" },
				{ text: "'a@test.com'", role: "constant", node: "a@test.com" },
				{ text: ", ", role: "symbol" },
				{ text: "'\"Roadmap\"'", role: "constant", node: '"Roadmap"' },
				{ text: ")", role: "symbol" },
			],
		});
		for (const [at, { tokens }] of projection.formulas.entries()) expect(tokens.map(({ text }) => text).join("")).toBe(unicodeOf((STATED[at] as TStatedFormula).formula));
		expect(
			projection.formulas
				.find(({ name }) => name === "r1")
				?.tokens.filter(({ node }) => node !== undefined)
				.map(({ node }) => node),
		).toEqual(["r1:X1", "r1:X1", "r1:Kitchen-reply(r1:X1)", "r1:X1"]);
	});

	it("selects the formulas of a node or an edge, and the nodes and edges of a formula", () => {
		const formulasOf = (id: string) => node(id)?.formulas;
		const ofFormula = (name: string) => ({
			nodes: projection.nodes.filter(({ formulas }) => formulas.includes(name)).map(({ id }) => id),
			edges: projection.edges.filter(({ formula }) => formula === name),
		});
		expect(formulasOf("b@test.com")).toEqual(["n2", "e1", "h1", "q1"]);
		expect(ofFormula("e1")).toEqual({ nodes: ["a@test.com", "b@test.com"], edges: [{ from: "b@test.com", to: "a@test.com", label: "inReplyTo", formula: "e1" }] });
	});

	it("counts the ground axioms, the rules and the conjectures, and joins the ASCII TPTP a line a formula", () => {
		expect(projection.summary).toEqual({ axioms: 7, rules: 1, conjectures: 1 });
		expect(projection.text.split("\n")).toEqual(projection.formulas.map(({ tptp }) => tptp));
	});

	it("draws the term graph the parse of its own emitted text yields", () => {
		const reparsed = projection.formulas.map(({ tptp }, at): TStatedFormula => {
			const parsed = parseFormula(tptp);
			if (!("annotated" in parsed)) throw new Error(`the parser refused ${tptp}: ${parsed.reason}`);
			const { annotated }: { annotated: TAnnotated } = parsed;
			return { ...(STATED[at] as TStatedFormula), ...annotated };
		});
		const { nodes, edges, clusters } = projected(reparsed);
		expect({ nodes, edges, clusters }).toEqual({ nodes: projection.nodes, edges: projection.edges, clusters: projection.clusters });
	});
});
