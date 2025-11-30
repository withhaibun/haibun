import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import Haibun from '@haibun/core/steps/haibun.js';

import { effort, Release_at, Release_domain } from '../backgrounds/workflow-bg.feature.ts';

const { ensure } = withAction(new ActivitiesStepper());
const { defineOrderedSet, setAs, is } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	'workflow': [
		feature({ feature: 'Workflow' }),
		`Demonstrate ordered domains, waypoints (proofs) and activities. The background Do work activity increments an effort counter and advances the release phase by one step. ensure() will attempt the proof first and run the activity body only when the proof fails.`,

		defineOrderedSet({ domain: Release_domain, values: '["concept" "plan" "dev" "prod"]' }),
		setAs({ what: 'phase', domain: Release_domain, value: 'concept' }),

		"Reach 'dev' by ensuring release is at dev.",
		scenario({ scenario: 'Promote to dev using Do work' }),
		ensure({ outcome: `${Release_at} dev` }),
		"After promoting from concept -> plan -> dev we expect two effort increments.",
		is({ what: effort, value: '2' }),

		`Check a previous phase, which should result in no new effort.`,
		scenario({ scenario: 'Went through plan using Do work' }),
		ensure({ outcome: `${Release_at} plan` }),
		`After checking plan we expect an unchanged work effort.`,
		is({ what: effort, value: '2' }),

		"Reach 'prod' by ensuring release is at prod.",
		scenario({ scenario: 'Promote to prod using Do work' }),
		ensure({ outcome: `${Release_at} prod` }),
		"After promoting to prod we expect effort of 3.",
		is({ what: effort, value: '3' }),

		scenario({ scenario: 'Check final phase variable' }),
		is({ what: 'phase', value: 'prod' }),
	],
};
