import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	Conjunctions: [
		feature({ feature: "Conjunctions" }),
		"A conjunction is stated in plain lines: a waypoint whose activity ensures each of its parts in order. A rule of the reasoner is N3, which a waypoint library states.",

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
