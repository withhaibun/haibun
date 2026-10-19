import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Formula notation": [
		feature({ feature: "Formula notation" }),
		"A kireji builder, a gwta line and a first-order formula parse to one engine term and render from it, and a proof renders in each form. The engine evaluates Horn rules, scoped negation as failure with stated falsity, quantifiers over closed domains, universals as rules, equality and functions (docs/reasoner.md, Formula notation).",

		scenario({ scenario: "A formula and a line are one term" }),
		"Essential, for people, models and features. Source: docs/reasoner.md, Formula notation.",
		'the formula "ready(m) <- cooked(m) and plated(m)" is the line "waypoint {m} is \\"ready\\" with {m} is \\"cooked\\" and {m} is \\"plated\\""',

		scenario({ scenario: "The ASCII form and the symbol form are one formula" }),
		"Essential. Source: docs/reasoner.md, Formula notation.",
		'the formula "forall x in meal. cooked(x) -> edible(x)" is the formula "∀x ∈ meal. cooked(x) → edible(x)"',

		scenario({ scenario: "A formula outside the fragment is refused with its remedy" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Formula notation.",
		'set refused from check the formula "cooked(x) or raw(x) <- meal(x)"',
		'variable refused.remedy is "split the rule into one rule per disjunct"',
	],
};
