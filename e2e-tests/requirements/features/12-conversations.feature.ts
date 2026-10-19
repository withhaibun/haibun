import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

const { feature, pendingScenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	"Conversations as features": [
		feature({ feature: "Conversations as features" }),
		`A conversation between people and a model is an actuality, each turn a scenario, and each claim, question or action a step that the engine proves, refutes or leaves unknown, under the speaker's capability, with prose as its framing. Today's sources are spopg's turns (turns.ts:332), core's conversation domains (conversation.ts:16) and the page's ask flow. It depends on one path for every surface, prose in context, a capability per speaker, products as facts and one vocabulary.
		Blocks it today: a quantifier's variable that stays set leaks between turns (logic-stepper.ts:77), and a turn records each tool call twice (turns.ts:353).`,

		pendingScenario({ scenario: "A turn's lines are proved under the speaker's capability" }),
		"Essential direction. Source: turns.ts:345.",
		'set turn from prove the turn "Is dinner ready? dinner is \\"ready\\"" as "ranger"',
		'variable turn.outcome is "unknown"',
	],
};
