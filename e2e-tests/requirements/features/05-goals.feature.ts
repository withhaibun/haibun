import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Goals over producer rules": [
		feature({ feature: "Goals over producer rules" }),
		`A step that produces a domain is a producer rule. Resolving a goal proves a fact of its domain over those rules and returns the plan, pursuing calls the plan, and a walk calls one step at a time with the values a person supplies (goal-resolution-stepper.ts, goal-resolver.ts).
		Accidental, and replaced by one depth limit and an ancestor check: the michi cap of 64, the depth of 8, the enumeration limit of 200,000 and the composite depth of 4 (goal-resolver.ts:128-135), the smoke goals option (goal-resolution-stepper.ts:89), and the change signal after every step (goal-resolution-stepper.ts:113).
		Unclear: whether the composite decomposition options (goal-resolution-stepper.ts:71-78) stay as options or become the one reading.`,

		scenario({ scenario: "Resolving a goal returns a plan from the producers" }),
		"Essential, for the affordances panel, a model and features. Source: goal-resolution-stepper.ts:196.",
		'set plan from resolve "var-snapshot"',
		'variable plan.finding is "michi"',

		scenario({ scenario: "A walk calls one step at a time with what a person supplies" }),
		"Essential. Source: walk-toward-a-goal.feature.",
		'set walked to "a value"',
		'set walk from walk toward "var-snapshot"',
		'variable walk.next is "VariablesStepper-showVar"',
		'set advanced from advance the walk `walk.walk` with {"what": "walked"}',
		'variable advanced.status is "completed"',

		scenario({ scenario: "A produced fact satisfies the goal" }),
		"Essential. Source: goal-resolver.ts:5.",
		'set produced to "a value"',
		"show var produced",
		'set again from resolve "var-snapshot"',
		'variable again.finding is "satisfied"',

		scenario({ scenario: "The chain of producers doesn't hold a blocking finding" }),
		"Essential, for the domain-chain lint at start. Source: runner.ts:29 and domain-chain-lint.ts:75.",
		"show chain lint",

		scenario({ scenario: "A goal's proof is a set of records" }),
		"Essential. Source: docs/reasoner.md, step 5.",
		'set proof from show derivation of "resolve \\"var-snapshot\\""',
		"variable proof.records exists",
	],
};
