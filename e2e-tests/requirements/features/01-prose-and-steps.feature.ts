import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Prose and steps": [
		feature({ feature: "Prose and steps" }),
		`The logic engine replaces the evaluation code. These features state what it keeps, one scenario per requirement, for every surface: a feature line, an RPC or MCP call, the LSP, a page's call and a model's tool call. A scenario whose step a stepper doesn't declare yet is a pending scenario: its lines don't resolve or run, and actuality's summary counts it as pending until the engine provides the step.
		Accidental, and replaced by one pattern match per registry entry: the leading words dePolite removes, the unique, fallback and precludes tie-breakers, and the quote restoration of withStatementsAsWritten (resolver.ts:176-227).`,

		scenario({ scenario: "A sentence is prose and a lowercase line is one step" }),
		"Essential, for every surface. Source: resolver.ts:13 and resolver.ts:176.",
		"This sentence frames the steps that follow it, and it passes.",
		'set greeting to "hello"',
		'variable greeting is "hello"',

		scenario({ scenario: "A placeholder takes a literal, a variable or a value of its domain" }),
		"Essential, for every surface. A bare term that isn't a variable or a domain value is refused. Source: feature-variables.ts and docs/architecture.md, Variable Resolution.",
		'set who to "Ada"',
		'set {who} greeted to "yes"',
		'variable Ada greeted is "yes"',
		"not variable greeting is unsetTerm",

		scenario({ scenario: "Every surface validates a line against the same steps" }),
		"Essential, for the LSP, the page and a model. Source: haibun-stepper.ts:165 and step-validation.ts.",
		'set checked from validate step "variable greeting exists"',
		'variable checked.method is "VariablesStepper-exists"',

		scenario({ scenario: "A line and its term convert both ways through one registry" }),
		"Essential, for proofs rendered as prose. Source: docs/reasoner.md, The predicate registry.",
		'the line "set greeting to \\"hello\\"" renders from its term as written',

		scenario({ scenario: "A waypoint whose name starts with a leading word resolves" }),
		"Essential. dePolite removes the leading word of the ensured statement and of the waypoint's name, so the names match. Source: resolver.ts:255, activities-stepper.ts:731 and util.ts:336.",
		"Activity: Lay the table",
		'set laid to "yes"',
		'waypoint The table is laid with variable laid is "yes"',
		"ensure The table is laid",
	],
};
