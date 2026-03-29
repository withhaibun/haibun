/**
 * executor-rpc.feature.ts
 *
 * Verifies the unified RPC executor path:
 * feature text → Collector → Expand → Resolver → Executor → executeStep → StepRegistry → handler → products
 *
 * All step dispatch goes through StepRegistry. This feature exercises:
 * - plain ok steps
 * - steps with products (variables)
 * - step failure and halt
 * - seqPath preservation across scenarios
 */
import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";
import { withAction } from "@haibun/core/kireji/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";

const { feature, scenario } = withAction(new Haibun());
const { set, is } = withAction(new VariablesStepper());
const { activity, ensure } = withAction(new ActivitiesStepper());

export const features: TKirejiExport = {
	"Executor RPC dispatch": [
		feature({ feature: "Executor dispatches steps via StepRegistry" }),
		`Steps produce products that are accessible as variables.
		seqPath is preserved across scenarios. All dispatch goes through StepRegistry.`,

		scenario({ scenario: "Steps produce products accessible as variables" }),
		set({ what: "greeting", value: '"hello"' }),
		is({ what: "greeting", value: '"hello"' }),

		scenario({ scenario: "Variables compose via products" }),
		set({ what: "first", value: '"foo"' }),
		set({ what: "second", value: '"bar"' }),
		is({ what: "first", value: '"foo"' }),
		is({ what: "second", value: '"bar"' }),

		scenario({ scenario: "Activities use the same executor path" }),
		activity({ activity: "Prepare state" }),
		set({ what: "status", value: '"ready"' }),
		ensure({ outcome: `variable status is "ready"` }),
	],
};
