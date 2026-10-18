import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";

import { effort, Release_at, Release_domain } from "../backgrounds/workflow-bg.feature.ts";

const { ensure } = withAction(new ActivitiesStepper());
const { defineOrderedSet, setAs, is } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	workflow: [
		feature({ feature: "Workflow" }),
		`This feature uses ordered domains, waypoints (proofs) and activities. The background Do work activity increments an effort counter and advances the release phase by one value. An ensure statement attempts the proof first and runs the activity body only when the proof fails.`,

		defineOrderedSet({ domain: Release_domain, values: '["concept" "plan" "dev" "prod"]' }),
		setAs({ what: "phase", domain: Release_domain, value: '"concept"' }),

		"Reach 'dev' by ensuring release is at dev.",
		scenario({ scenario: "Promote to dev using Do work" }),

		ensure({ outcome: `${Release_at} "dev"` }),
		"Promoting from concept to plan to dev increments the effort twice.",
		is({ what: effort, value: '"2"' }),

		`Ensuring an earlier phase doesn't add effort.`,
		scenario({ scenario: "A phase already reached doesn't run Do work" }),
		ensure({ outcome: `${Release_at} "plan"` }),
		`Ensuring plan leaves the effort unchanged.`,
		is({ what: effort, value: '"2"' }),

		"Reach 'prod' by ensuring release is at prod.",
		scenario({ scenario: "Promote to prod using Do work" }),
		ensure({ outcome: `${Release_at} "prod"` }),
		"Promoting to prod increments the effort to 3.",
		is({ what: effort, value: '"3"' }),

		scenario({ scenario: "Check final phase variable" }),
		is({ what: "phase", value: '"prod"' }),
	],
};
