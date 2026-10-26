import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Combined statements": [
		feature({ feature: "Combined statements" }),
		`Statements combine in plain English. A scenario's steps run in order, and a step that fails ends the scenario, so the steps of a scenario hold together. Coordination with and is a universal over a closed domain, coordination with or is any of, and a named Activity combines the statements its waypoint ensures. Each line names its subjects, and a line doesn't refer to a subject another line named.
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

		scenario({ scenario: "Coordination with and joins statements" }),
		"Essential, for people and models. Every member of a closed domain joins the statements that differ by that member. Source: docs/reasoner.md, Combined statements.",
		'set of Platters is ["soup", "bread"]',
		'set soup to "cooked"',
		'set bread to "cooked"',
		'every course in Platters is variable {course} is "cooked"',

		scenario({ scenario: "Coordination with or holds where one statement holds" }),
		"Essential, for people and models. Source: docs/reasoner.md, Combined statements.",
		'set supper to "cooked"',
		'any of "variable breakfast is \\"cooked\\", variable supper is \\"cooked\\""',

		scenario({ scenario: "A relative clause states a universal over a closed domain" }),
		"Essential, for the formal model. Source: docs/reasoner.md, Combined statements.",
		'set of Dishes is ["stew", "salad"]',
		'set stew to "cooked"',
		'for every {dish: Dishes} where variable {dish} is "cooked", {dish} is edible',
		'"stew" is edible',
		'not "salad" is edible',

		scenario({ scenario: "A proof renders as its statements in proof order, the goal last" }),
		"Essential, for people and models. The verdict is the proof's, and each statement's is in its record. Source: docs/reasoner.md, Proofs as SeqPath records.",
		'set dessert to "cooked"',
		"show var dessert",
		'set proof from resolve "var-snapshot"',
		'variable proof.statements.0 is "show var dessert"',
		'variable proof.statements.1 is "resolve \\"var-snapshot\\""',
		'variable proof.verdict is "proved"',
	],
};
