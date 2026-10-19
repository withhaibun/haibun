import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Waypoints and ensure": [
		feature({ feature: "Waypoints and ensure" }),
		`A waypoint is a rule: its head holds where its proof holds, and its activity is the plan that makes the proof hold. Ensure reads P or, failing P, the activity and then P (activities-stepper.ts:70).
		Accidental, and replaced by rule clauses with unification: the attempt count of 10 (activities-stepper.ts:279), the virtual step per outcome and its pattern rewriting (activities-stepper.ts:612), the step swapping per feature (activities-stepper.ts:101-163), the line scanning (activities-stepper.ts:686-770), the declarative branch (activities-stepper.ts:305-352), and the ensure and graph-link events (activities-stepper.ts:534-552, 664-684).`,

		scenario({ scenario: "Ensure runs the activity only where the proof fails" }),
		"Essential, for features and saved waypoints. Source: activities-stepper.ts:269.",
		'set runs to "0"',
		"Activity: Count a run",
		"increment runs",
		'waypoint Runs are counted with variable runs is "1"',
		"ensure Runs are counted",
		"ensure Runs are counted",
		'variable runs is "1"',

		scenario({ scenario: "A waypoint binds its placeholder to the argument" }),
		"Essential. Source: activities.feature and activities-stepper.ts:612.",
		"Activity: Greet someone",
		"set greeted to {who}",
		"waypoint Greeted {who} with variable greeted is {who}",
		'ensure Greeted "Ada"',
		'variable greeted is "Ada"',

		scenario({ scenario: "Ensure fails where the activity doesn't make the proof hold" }),
		"Essential. Source: activities-stepper.ts:632.",
		"Activity: Leave it unset",
		'set left to "no"',
		'waypoint It is set with variable left is "yes"',
		"not ensure It is set",

		scenario({ scenario: "A failed ensure states the first goal it couldn't prove" }),
		"Essential, for people and models. Source: docs/reasoner.md, Proofs as SeqPath records.",
		'set unmet from show derivation of "ensure It is set"',
		'variable unmet.firstUnmet is "variable left is \\"yes\\""',
	],
};
