/**
 * The engine's fragment of TPTP FOF: each formula outside it, and each formula that names a predicate the registry doesn't hold,
 * is refused at parse time with its remedy, and each formula in it renders in Unicode notation. The parser reads each formula
 * that the TPTP rendering writes, and returns the tree that the rendering read.
 */
import { describe, expect, it } from "vitest";
import { checkFormula, constantOf, literalOf, parseFormula, tptpOf, unicodeOf, type TAnnotated, type TFormula, type TTerm } from "./formula.js";

/** The registry's predicates by name, with their arity, that the formulas of these cases name. */
const KNOWN = new Map([
	["cooked", 1],
	["plated", 1],
	["ready", 1],
	["edible", 1],
	["raw", 1],
	["served", 1],
	["side", 2],
	["Stepper-step", 1],
]);

const REFUSED: [string, string, string][] = [
	["a formula that doesn't parse", "fof(r, axiom", "write one annotated formula, fof(name, role, formula)."],
	[
		"a predicate the registry doesn't hold",
		"fof(r, axiom, burnt(lunch)).",
		"name a step by its method, quoted as 'Stepper-step', with its parameters in its pattern's order, or guard a variable with member_of(X, d)",
	],
	[
		"a predicate with another arity than the registry holds",
		"fof(r, axiom, side(lunch)).",
		"name a step by its method, quoted as 'Stepper-step', with its parameters in its pattern's order, or guard a variable with member_of(X, d)",
	],
	["a disjunction in a conclusion", "fof(r, axiom, ![X] : (member_of(X, meal) => (cooked(X) | raw(X)))).", "split the rule into one rule per disjunct"],
	[
		"an existential in a conclusion",
		"fof(r, axiom, ![X] : (member_of(X, meal) => ?[Y] : side(X, Y))).",
		"name the individual that the conclusion states exists, as a constant or as a function of its variables",
	],
	["a quantifier without a guard", "fof(r, axiom, ![X] : edible(X)).", "close the domain with set of, and guard the variable with member_of(X, d)"],
	["~ before a conclusion", "fof(r, axiom, ![X] : (member_of(X, meal) => ~raw(X))).", "state the falsity as a negated ground axiom"],
	["~ before a formula that isn't an atom", "fof(r, axiom, ~(cooked(lunch) & raw(lunch))).", "state the formula as a rule of its own, and negate that rule's atom"],
	["an equivalence", "fof(r, axiom, ![X] : (cooked(X) <=> edible(X))).", "state each direction as a rule"],
	["a connective outside the fragment", "fof(r, axiom, cooked(lunch) <~> raw(lunch)).", "restate the formula with ~, & and =>"],
	["a role other than axiom and conjecture", "fof(r, hypothesis, cooked(lunch)).", "state the formula as fof, with the role axiom for a fact or a rule and conjecture for a goal"],
	["a language other than fof", "cnf(r, axiom, cooked(lunch)).", "state the formula as fof, with the role axiom for a fact or a rule and conjecture for a goal"],
];

const RENDERED: [string, string][] = [
	["fof(ready, axiom, ![M] : ((cooked(M) & plated(M)) => ready(M))).", "∀M. cooked(M) ∧ plated(M) → ready(M)"],
	["fof(edible, axiom, ![X] : ((member_of(X, meal) & cooked(X)) => edible(X))).", "∀X ∈ meal. cooked(X) → edible(X)"],
	["fof(lunch_not_served, axiom, ~served(lunch)).", "¬served(lunch)"],
	["fof(dinner_ready, conjecture, ready(dinner)).", "ready(dinner)"],
	["fof(stepped, conjecture, 'Stepper-step'(dinner)).", "'Stepper-step'(dinner)"],
	["fof(edible_meal, axiom, ![X] : (edible(X) <= (member_of(X, meal) & cooked(X) & ~raw(X) & X != tea))).", "∀X. edible(X) ← member_of(X, meal) ∧ cooked(X) ∧ ¬raw(X) ∧ X ≠ tea"],
];

describe("the engine's fragment of TPTP FOF", () => {
	it.each(REFUSED)("refuses %s with its remedy", (_, formula, remedy) => {
		expect(checkFormula(formula, KNOWN)).toMatchObject({ remedy });
	});

	it.each(RENDERED)("holds %s and renders it in Unicode notation", (formula, rendered) => {
		const checked = checkFormula(formula, KNOWN);
		if (!("annotated" in checked)) throw new Error(`the fragment refused ${formula}: ${checked.reason}`);
		expect(unicodeOf(checked.annotated.formula)).toBe(rendered);
	});
});

/** Names across TPTP's quoting: a lower word, an upper word, punctuation, ' and \, a JSON literal and a text beyond ASCII. */
const NAMES = ["dinner", "isPartOf", "Email", "step-4", "it's", "a\\b", "two words", literalOf("Alice").functor, literalOf(3).functor, constantOf("Café").functor];
const constant = (functor: string): TTerm => ({ functor, args: [] });
const TERMS: TTerm[] = [...NAMES.map(constant), { variable: "X1" }, { functor: "Stepper-step", args: [{ variable: "X1" }, { functor: "f", args: [constant("Email")] }] }];
const atomOf = (predicate: string, args: TTerm[]): TFormula => ({ atom: predicate, args });
const ATOMS: TFormula[] = NAMES.map((name, at) => atomOf(name, [TERMS[at % TERMS.length] as TTerm, TERMS[(at + 3) % TERMS.length] as TTerm]));
const [P, Q, R] = ATOMS as [TFormula, TFormula, TFormula];
const binary = (connective: string, left: TFormula, right: TFormula): TFormula => ({ connective, left, right });
/** A record's type as a unary predicate named by its label, a lower word or quoted, as a graph's axioms state it. */
const TYPES: TFormula[] = ["email", "Email", "SeqPath", "observation/http-trace"].map((type) => atomOf(type, [constant("m1")]));
const FORMULAS: TFormula[] = [
	...ATOMS,
	...TYPES,
	atomOf("ready", []),
	{ equal: true, left: { variable: "X1" }, right: constant("tea") },
	{ equal: false, left: constant("it's"), right: constant("Email") },
	{ not: P },
	{ not: { not: P } },
	{ not: binary("&", P, Q) },
	...["&", "|", "=>", "<="].flatMap((connective) => [binary(connective, P, Q), binary(connective, binary(connective, P, Q), R), binary(connective, P, binary(connective, Q, R))]),
	binary("=>", binary("&", P, binary("|", Q, R)), { not: R }),
	{ quantifier: "!", variables: ["X1"], body: binary("=>", P, Q) },
	{ quantifier: "?", variables: ["X1", "X2"], body: binary("&", P, Q) },
	{ quantifier: "!", variables: ["X1"], body: { quantifier: "?", variables: ["X2"], body: P } },
	binary("&", { quantifier: "!", variables: ["X1"], body: P }, { not: { equal: true, left: { variable: "X1" }, right: constant("dinner") } }),
];
const ANNOTATED: TAnnotated[] = FORMULAS.flatMap((formula, at) => ["axiom", "conjecture"].map((role) => ({ name: NAMES[at % NAMES.length] as string, role, formula })));

describe("the TPTP rendering of a formula", () => {
	it.each(ANNOTATED.map((annotated) => [tptpOf(annotated), annotated] as const))("parses %s back to the tree it was written from", (text, annotated) => {
		expect(parseFormula(text)).toEqual({ annotated });
	});

	it.each([
		[{ name: "e12", role: "axiom", formula: atomOf("isPartOf", [constant("step-4"), constant("scenario-1")]) }, "fof(e12, axiom, isPartOf('step-4', 'scenario-1'))."],
		[{ name: "n3", role: "axiom", formula: atomOf("email", [constantOf("m1")]) }, "fof(n3, axiom, email(m1))."],
		[{ name: "n4", role: "axiom", formula: atomOf("Email", [constantOf("m-1")]) }, "fof(n4, axiom, 'Email'('m-1'))."],
		[{ name: "p1", role: "axiom", formula: atomOf("name", [constantOf("person-1"), literalOf("Café")]) }, "fof(p1, axiom, name('person-1', '\"Caf\\\\u00e9\"'))."],
		[{ name: "p2", role: "axiom", formula: atomOf("count", [constantOf("it's"), literalOf(true)]) }, "fof(p2, axiom, count('it\\'s', true))."],
	] satisfies [TAnnotated, string][])("writes %o as %s, quoting each name that isn't a lower word", (annotated, text) => {
		expect(tptpOf(annotated)).toBe(text);
	});

	it("refuses a name TPTP's single quotes can't hold, and a quoted name the BNF doesn't define", () => {
		expect(() => tptpOf({ name: "p", role: "axiom", formula: atomOf("name", [constant("Café")]) })).toThrow("name a text through nameOfText or literalOf");
		expect(parseFormula("fof(p, axiom, name('Café')).")).toMatchObject({ remedy: "write one annotated formula, fof(name, role, formula)." });
	});
});
