import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Waypoints and ensure": [
		feature({ feature: "Waypoints and ensure" }),
		`A waypoint is a rule: its head holds where its proof holds, and its activity is the plan that makes the proof hold. Ensure reads P or, failing P, the activity and then P. A line unifies with a rule's head through the head's pattern, and the logic engine applies the rule (activities-stepper.ts, apply; haibun.pl, applied).
		Accidental, and replaced by the rules: a step for each waypoint and its pattern rewriting, the step swapping per feature, and the scanning of the lines around each waypoint.`,

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
		"Essential. Ensure applies the waypoint whose head the line matches, and runs only that waypoint's activity. Source: activities-stepper.ts:612.",
		"Activity: Greet someone",
		"set greeted to {who}",
		"waypoint Greeted {who} with variable greeted is {who}",
		"Activity: Wave to someone",
		"set waved to {who}",
		"waypoint Waved to {who} with variable waved is {who}",
		'ensure Greeted "Ada"',
		'variable greeted is "Ada"',
		"not variable waved exists",

		scenario({ scenario: "A goal unifies with a waypoint's head, whose placeholder names a domain" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Waypoints as rules with unification.",
		'set of meal is ["dinner", "lunch"]',
		"Activity: Make a meal ready",
		'set {m} to "ready"',
		'waypoint {m:meal} is ready with variable {m} is "ready"',
		"ensure dinner is ready",
		'variable dinner is "ready"',
		"not variable lunch exists",

		scenario({ scenario: "A waypoint's head in a proof is a goal that starts a sub-proof" }),
		"Essential. The proof of the goal's rule is proved beneath it, and the rule's activity doesn't run. Source: haibun.pl, plan(prove).",
		"Activity: Cook supper",
		'set cooked to "yes"',
		'waypoint Supper is cooked with variable cooked is "yes"',
		"Activity: Serve supper",
		'set served to "yes"',
		"waypoint Supper is served with Supper is cooked",
		"not ensure Supper is served",
		'variable served is "yes"',
		"not variable cooked exists",

		scenario({ scenario: "Ensure fails where the activity doesn't make the proof hold" }),
		"Essential. Source: activities-stepper.ts:632.",
		"Activity: Leave it unset",
		'set left to "no"',
		'waypoint It is set with variable left is "yes"',
		"not ensure It is set",

		scenario({ scenario: "A waypoint a step saves runs its lines" }),
		"Essential, for a model's turn saved as a waypoint and run again. Source: activities-stepper.ts, saveWaypoint.",
		'save waypoint "Knock twice" doing ["set knocks to \\"2\\""]',
		'run the saved waypoint "Knock twice"',
		'variable knocks is "2"',

		scenario({ scenario: "A failed ensure states the first goal it couldn't prove" }),
		"Essential, for people and models. Source: docs/reasoner.md, Proofs as SeqPath records.",
		"Activity: Leave it open",
		'set open to "no"',
		'waypoint It is closed with variable open is "yes"',
		'set unmet from show derivation of "ensure It is closed"',
		'variable unmet.firstUnmet is "variable open is \\"yes\\""',
	],
};
