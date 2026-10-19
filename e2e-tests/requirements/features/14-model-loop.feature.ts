import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"A model proposes lines and the engine proves them": [
		feature({ feature: "A model proposes lines and the engine proves them" }),
		"A turn sends a model its context as lines, the model proposes lines under the speaker's capability, and the engine proves, refutes or leaves each one unknown and returns the proof, the refusal or the first unmet goal as lines. Today's sources are spopg's tools-projection.ts, briefing.ts, context.ts and turn.ts:14.",

		scenario({ scenario: "A proposed action runs only under a capability that grants it" }),
		"Essential, for a model's tool calls. Source: turns.ts:357.",
		'set proposal from the model proposes "set x to \\"1\\"" as "ranger"',
		'variable proposal.outcome is "refused"',

		scenario({ scenario: "A model's output enters as a fact derived by a model" }),
		"Essential, for provenance. Source: docs/reasoner.md, The model loop.",
		'fact summary of "dinner" was derived by a model',

		scenario({ scenario: "A rule can require a person's confirmation before an action" }),
		"Essential, for actions that read a fact derived by a model. Source: docs/reasoner.md, The model loop.",
		'not the model proposes "delete the record" as "ranger" without confirmation',
	],
};
