import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario, pendingScenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Combinators and quantifiers": [
		feature({ feature: "Combinators and quantifiers" }),
		`Each combinator has one formal reading in any position: not is negation as failure, where is implication, any of is disjunction, maybe is P or true, some and every quantify over a closed domain, and whenever repeats an activity while its condition holds (logic-stepper.ts).
		Accidental, and replaced by the readings: the comma splitting of any of (logic-stepper.ts:172), the quote stripping (logic-stepper.ts:86), the quantifier's variable that stays set after it (logic-stepper.ts:77), the metric variables named with a slash (logic-stepper.ts:82), the loop count of 1,000 (logic-stepper.ts:125), the maybe-outcome product (logic-stepper.ts:13) and the speculative mode that marks an expected failure (flow-runner.ts:31).`,

		scenario({ scenario: "Negation, implication, disjunction and maybe" }),
		"Essential, for every surface. Source: logic-stepper.ts:148-207.",
		"not variable neverSet exists",
		'where variable neverSet exists, ends with "not OK"',
		'set present to "yes"',
		'any of "variable neverSet exists, variable present exists"',
		"maybe variable neverSet exists",
		"not not variable present exists",

		scenario({ scenario: "Every holds over an empty domain and some doesn't" }),
		"Essential, for the formal model. Source: logic-stepper.ts:232 and logic-stepper.ts:266.",
		'set of Meals is ["dinner", "lunch"]',
		"every meal in Meals is {meal} is in Meals",
		'some meal in Meals is matches {meal} with "din*"',
		'not every meal in Meals is matches {meal} with "din*"',

		scenario({ scenario: "Quantifiers nest" }),
		"Essential. Source: docs/architecture.md, Quantifiers.",
		'set of Hosts is ["api.example.com", "cdn.example.com"]',
		'set of Allowed is ["example.com"]',
		'every host in Hosts is some domain in Allowed is matches {host} with "*{domain}"',

		scenario({ scenario: "Whenever repeats its action while the condition holds" }),
		"Essential. Source: logic-stepper.ts:120.",
		'ordered set of Count is ["zero", "one", "two"]',
		'set tally as Count to "zero"',
		'whenever variable tally is less than "two", increment tally',
		'variable tally is "two"',

		pendingScenario({ scenario: "A negation states whether its statement is refuted or unknown" }),
		"Essential, for the open world. Source: docs/reasoner.md, step 7.",
		'absent dinner is "raw"',
		'set status from the status of dinner is "raw"',
		'variable status is "refuted"',
	],
};
