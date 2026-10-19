import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Combined statements": [
		feature({ feature: "Combined statements" }),
		`Statements combine in plain English. A scenario's steps run in order, and a step that fails ends the scenario, so the steps of a scenario hold together. Coordination with and and or joins two statements, and a named Activity combines the statements its waypoint ensures. Each line names its subjects, and a line doesn't refer to a subject another line named.
		A proof renders as its statements in proof order: the statements that support the goal first, and the goal last. The verdict of each statement is in its record (docs/reasoner.md, Combined statements).`,

		scenario({ scenario: "The steps of a scenario hold together in order" }),
		"Essential, for every surface. Source: executor.ts, doFeature.",
		'set dinner to "cooked"',
		'set lunch to "cooked"',
		'variable dinner is "cooked"',
		'variable lunch is "cooked"',

		scenario({ scenario: "A named Activity combines the statements its waypoint ensures" }),
		"Essential, for people and models. Source: activities-stepper.ts.",
		"Activity: Serve dinner",
		'set served to "yes"',
		'set plated to "yes"',
		'waypoint Dinner is served with variable served is "yes"',
		"ensure Dinner is served",
		'variable plated is "yes"',

		scenario({ scenario: "Coordination with and joins two statements" }),
		"Essential, for people and models. Source: docs/reasoner.md, Combined statements.",
		'set dinner to "cooked"',
		'set lunch to "cooked"',
		'variable dinner is "cooked" and variable lunch is "cooked"',

		scenario({ scenario: "Coordination with or holds where one statement holds" }),
		"Essential, for people and models. Source: docs/reasoner.md, Combined statements.",
		'set lunch to "cooked"',
		'variable dinner is "cooked" or variable lunch is "cooked"',

		scenario({ scenario: "A relative clause states a universal over a closed domain" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Combined statements.",
		'set of Meals is ["dinner", "lunch"]',
		"every meal in Meals that is cooked is edible",

		scenario({ scenario: "A proof renders as its statements in proof order, the goal last" }),
		"Essential, for people and models. The verdict of each statement is in its record. Source: docs/reasoner.md, Proofs as SeqPath records.",
		'set dinner to "cooked"',
		'set proof from show proof of "where variable dinner is \\"cooked\\", set served to \\"yes\\""',
		'variable proof.statements.0.line is "variable dinner is \\"cooked\\""',
		'variable proof.statements.2.line is "where variable dinner is \\"cooked\\", set served to \\"yes\\""',
		'variable proof.statements.2.verdict is "proved"',
	],
};
