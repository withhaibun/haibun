/**
 * Verifies the path a feature step takes:
 * feature text → Collector → Expand → Resolver → Executor → dispatchStep → StepRegistry → handler → products
 *
 * An RPC call enters the same path at dispatchStep. dispatchStep reads every step's handler from StepRegistry. The scenarios exercise:
 * - a step that sets a variable and a step that reads it
 * - two variables that separate steps set and read
 * - an activity on the same executor path
 */
import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";

const { feature, scenario } = withAction(new Haibun());
const { set, is } = withAction(new VariablesStepper());
const { activity, ensure } = withAction(new ActivitiesStepper());

export const features: TKirejiExport = {
	"Executor RPC dispatch": [
		feature({ feature: "Executor dispatches steps via StepRegistry" }),
		`Steps set variables that later steps read.
		The executor calls dispatchStep for each step. The dispatchStep function reads the step's handler from StepRegistry.`,

		scenario({ scenario: "Steps set variables that later steps read" }),
		set({ what: "greeting", value: '"hello"' }),
		is({ what: "greeting", value: '"hello"' }),

		scenario({ scenario: "Two variables keep separate values" }),
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
