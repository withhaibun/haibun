import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Combined statements": [
		feature({ feature: "Combined statements" }),
		`A few grammar rules over the registry's patterns combine statements: coordination with and and or, a shared subject with ellipsis, a relative clause, and a reference back to a subject the scenario or turn named. Each sentence parses to exactly one term, and an ambiguous sentence is refused with its remedy (docs/reasoner.md, Combined statements).
		Accidental, and replaced by the grammar: the comma splitting of any of (logic-stepper.ts:166-180), the condition forms of where (logic-stepper.ts:148-163) and the regular expressions of some and every (logic-stepper.ts:214-280).`,

		scenario({ scenario: "Coordination and ellipsis share a subject" }),
		"Essential, for people and models. Source: docs/reasoner.md, Combined statements.",
		'assert dinner is "cooked"',
		'assert dinner is "plated"',
		"dinner is cooked and plated",
		'assert lunch is "ready"',
		"dinner or lunch is ready",

		scenario({ scenario: "A relative clause states a universal" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Formula notation.",
		"every meal that is cooked is edible",
		'the sentence "every meal that is cooked is edible" is the formula "forall x in meal. cooked(x) -> edible(x)"',

		scenario({ scenario: "A reference back reads the subject named earlier in the scenario" }),
		"Essential, for conversation turns. Source: docs/reasoner.md, Combined statements.",
		'assert the message is "sent"',
		'it is "sent"',

		scenario({ scenario: "A proof renders as one sentence per subject" }),
		"Essential, for people and models. Source: docs/reasoner.md, Combined statements.",
		'set told from show derivation of "dinner is ready" as prose',
		'variable told is "dinner is ready, because it is cooked (0.1.2) and plated (0.1.4)"',

		scenario({ scenario: "A reference with two candidates is refused with its remedy" }),
		"Essential, for the guardrail. Source: docs/reasoner.md, Combined statements.",
		'assert dinner is "cooked"',
		'assert lunch is "cooked"',
		'set refused from check the sentence "it is plated"',
		'variable refused.remedy is "name dinner or lunch in place of it"',

		scenario({ scenario: "A sentence with two parses is refused with its remedy" }),
		"Essential, for the guardrail. Source: docs/reasoner.md, Combined statements.",
		'set refused from check the sentence "dinner or lunch is ready and hot"',
		"variable refused.parses is 2",
	],
};
