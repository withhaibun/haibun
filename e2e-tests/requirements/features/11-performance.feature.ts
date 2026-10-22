import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { steps } from "@haibun/logic/waypoints/backgrounds/steps.feature.ts";

const { feature, scenario, pendingScenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	Performance: [
		feature({ feature: "Performance" }),
		"A process starts the engine once, and each top-level step adds one query and each call one more, each about 0.1 ms at 1,000 facts and under 1 ms at 10,000 (docs/reasoner.md, The spike). A service feature runs for weeks, so what a step retains is bounded (step-dispatch.ts:89-101).",

		scenario({ scenario: "A step takes milliseconds of its own" }),
		"Essential. Source: logic-stepper.ts, the steps source.",
		"set fast to 1",
		steps.tookLessThan('"set fast to 1"', "50"),

		pendingScenario({ scenario: "A proof over a thousand facts takes under a millisecond" }),
		"Essential. Source: docs/reasoner.md, q6-cost.",
		'the engine proves "variable fast is \\"yes\\"" over 1000 facts within 1 ms',
	],
};
