import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

/** A rule over the registry's steps: each guest whose variable exists is a member of the guests. */
const SEATED = "fof(seated, axiom, ![X] : ((member_of(X, guests) & 'VariablesStepper-exists'(X)) => 'VariablesStepper-isIn'(X, guests))).";
/** A rule whose conclusion is a disjunction, which the engine's fragment doesn't hold. */
const LISTED = "fof(listed, axiom, ![X] : (member_of(X, guests) => ('VariablesStepper-exists'(X) | 'VariablesStepper-isIn'(X, guests)))).";
/** The validation of a rule line that enters a formula. */
const validated = (formula: string) => `validate step "rule \\"${formula}\\""`;

export const features: TKirejiExport = {
	"Formula notation": [
		feature({ feature: "Formula notation" }),
		`A formula is TPTP FOF, as the TPTP syntax BNF states it (https://www.tptp.org/TPTP/SyntaxBNF.html), restricted to the engine's fragment: Horn rules, scoped negation as failure with stated falsity, quantifiers over closed domains, equality and functions. TPTP states a complex rule of a single purpose, and plain lines state everything else.
		One rule line enters each formula. The line resolves only where its formula parses, is in the fragment, and names a step of the registry or the guard of a closed domain for each predicate. Every other line names the rule (docs/reasoner.md, Formula notation).`,

		scenario({ scenario: "A rule line enters one formula, and other lines name the rule" }),
		"Essential, for people, models and features. Source: logic-stepper.ts, rule.",
		`set seated from rule "${SEATED}"`,
		'variable seated.name is "seated"',
		'variable seated.role is "axiom"',

		scenario({ scenario: "A bad formula, an unknown predicate and a formula outside the fragment are each refused as the line resolves" }),
		"Essential, for the formal model and the guardrail. Each refusal states its remedy. Source: formula.ts and resolver.ts, refusingWritten.",
		`set unparsed from ${validated("fof(broken, axiom")}`,
		'variable unparsed.valid is "false"',
		'matches unparsed.error with "*write one annotated formula*"',
		`set unknown from ${validated("fof(burnt, axiom, burnt(dinner)).")}`,
		'variable unknown.valid is "false"',
		`matches unknown.error with "*burnt/1 isn't an entry of the registry*"`,
		`set outside from ${validated(LISTED)}`,
		'variable outside.valid is "false"',
		'matches outside.error with "*split the rule into one rule per disjunct*"',

		scenario({ scenario: "A conjunction is a waypoint whose activity ensures each part" }),
		"Essential, for people and models. A waypoint's proof is one statement, and its activity ensures the waypoints it depends on in order. Source: activities-stepper.ts.",
		"Activity: Cook dinner",
		'set cooked to "yes"',
		'waypoint Dinner is cooked with variable cooked is "yes"',
		"Activity: Plate dinner",
		'set plated to "yes"',
		'waypoint Dinner is plated with variable plated is "yes"',
		"Activity: Make dinner ready",
		"ensure Dinner is cooked",
		"ensure Dinner is plated",
		'set ready to "yes"',
		'waypoint Dinner is ready with variable ready is "yes"',
		"ensure Dinner is ready",
		'variable plated is "yes"',
	],
};
