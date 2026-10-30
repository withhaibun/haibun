import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Goals over producer rules": [
		feature({ feature: "Goals over producer rules" }),
		`A step that produces a domain is a producer rule. Resolving a goal proves a fact of its domain over those rules in the logic engine and returns the plan, pursuing calls the plan, and a plan calls one of its steps at a time with the values a person supplies (logic-stepper.ts, pipelines/goals.ts, rules/goals.n3).
		Accidental, and replaced by the engine's depth limit and ancestor check: the plan cap, the depth and the enumeration limit of the TypeScript resolver, the smoke goals option, and the change signal after every step, which a view reads as the end of a step. A composite domain decomposes into its fields within the depth limit and the ancestor check, without an option or a depth of its own.`,

		scenario({ scenario: "Resolving a goal returns a plan from the producers" }),
		"Essential, for the affordances panel, a model and features. Source: pipelines/goals.ts, resolved.",
		'set plan from resolve "var-snapshot"',
		'variable plan.verdict is "unknown"',
		"Pursuing the goal refuses its plan, which takes a value from the caller.",
		'didn\'t pursue "var-snapshot"',

		scenario({ scenario: "A plan calls one of its steps at a time with what a person supplies" }),
		"Essential. Source: pipelines/goals.ts, planBegun and planAdvanced.",
		'set supplied to "a value"',
		'set planned from plan "var-snapshot"',
		'variable planned.status is "running"',
		'variable planned.next is "VariablesStepper-showVar"',
		'variable planned.needs.0 is "what"',
		'set advanced from advance plan `planned.plan` with {"what": "supplied"}',
		'variable advanced.status is "ended"',
		"variable advanced.factIds.length is 1",

		scenario({ scenario: "A produced fact satisfies the goal" }),
		"Essential, with the proof in proof order, the goal last. Source: pipelines/goals.ts, resolved.",
		'set produced to "a value"',
		"show var produced",
		'set again from resolve "var-snapshot"',
		'variable again.verdict is "proved"',
		'variable again.statements.1 is "resolve \\"var-snapshot\\""',
		"Pursuing a proved goal returns its proof without a call.",
		'set pursued from pursue "var-snapshot"',
		'variable pursued.verdict is "proved"',

		scenario({ scenario: "The chain of producers doesn't hold a blocking finding" }),
		"Essential, for the declarations check at start, which refuses a parameter whose domain is string. The affordances carry the chain's lint findings. Source: declarations.ts and haibun.pl lint/2.",
		"set offered from show affordances",
		"variable offered.findings exists",

		scenario({ scenario: "A goal's proof is a set of records" }),
		"Essential. Source: docs/reasoner.md, step 5.",
		'set proof from show derivation of "resolve \\"var-snapshot\\""',
		"variable proof.records exists",
	],
};
