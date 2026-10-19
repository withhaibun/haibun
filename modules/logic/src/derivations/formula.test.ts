/**
 * The engine's fragment of TPTP FOF: each formula outside it, and each formula that names a predicate the registry doesn't hold,
 * is refused at parse time with its remedy, and each formula in it renders in Unicode notation.
 */
import { describe, expect, it } from "vitest";
import { checkFormula, unicodeOf } from "./formula.js";

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
