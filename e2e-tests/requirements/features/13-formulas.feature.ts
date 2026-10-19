import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Formula notation": [
		feature({ feature: "Formula notation" }),
		`A formula a person writes is TPTP FOF, as the TPTP syntax BNF states it (https://www.tptp.org/TPTP/SyntaxBNF.html), restricted to the engine's fragment: Horn rules, scoped negation as failure with stated falsity, quantifiers over closed domains, equality and functions. A formula, a gwta line and a kireji builder parse to one engine term and render from it.
		Display renders the same terms in standard Unicode notation, and N3 stays the export to the open world that EYE checks (docs/reasoner.md, Formula notation).`,

		scenario({ scenario: "A formula and a line are one term" }),
		"Essential, for people, models and features. Source: docs/reasoner.md, Formula notation.",
		'the formula "fof(ready, axiom, ![M] : ((cooked(M) & plated(M)) => ready(M)))." is the line "waypoint {m} is \\"ready\\" with {m} is \\"cooked\\" and {m} is \\"plated\\""',

		scenario({ scenario: "A formula renders in Unicode notation" }),
		"Essential, for the monitor, a proof and a model's context. Source: docs/reasoner.md, Formula notation.",
		'the formula "fof(edible, axiom, ![X] : ((member_of(X, meal) & cooked(X)) => edible(X)))." renders as "∀X ∈ meal. cooked(X) → edible(X)"',

		scenario({ scenario: "A formula outside the fragment is refused with its remedy" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Formula notation.",
		'set refused from check the formula "fof(cooked_or_raw, axiom, ![X] : (member_of(X, meal) => (cooked(X) | raw(X))))."',
		'variable refused.remedy is "split the rule into one rule per disjunct"',
	],
};
