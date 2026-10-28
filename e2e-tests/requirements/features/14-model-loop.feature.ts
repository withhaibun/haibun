import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"A model proposes lines and the engine proves them": [
		feature({ feature: "A model proposes lines and the engine proves them" }),
		"A turn sends a model its context as lines, the model proposes lines under the speaker's capability, and the engine proves, refutes or leaves each one unknown and returns the proof, the refusal or the first unmet goal as lines. Sources are the model's projections, briefing, context and turn pipelines.",

		scenario({ scenario: "A proposed action runs only under a capability that grants it" }),
		"Essential, for a model's tool calls. A turn calls each line a model proposes under the speaker's capability, as holding only proves a statement under the actions it names. Source: turns.ts:357 and authority-stepper.ts, holdingOnly.",
		'holding only "VariablesStepper:set,Read:public", set x to "1"',
		'variable x is "1"',
		'set proposal from didn\'t holding only "Read:public", set x to "2"',
		'variable proposal.lacksAction is "VariablesStepper:set"',
		'variable x is "1"',

		"Pending scenario: A model's output enters as a fact derived by a model",
		"Essential, for provenance. Source: docs/reasoner.md, The model loop.",
		'fact summary of "dinner" was derived by a model',

		"Pending scenario: A rule can require a person's confirmation before an action",
		"Essential, for actions that read a fact derived by a model. Source: docs/reasoner.md, The model loop.",
		'didn\'t the model proposes "delete the record" as "ranger" without confirmation',
	],
};
