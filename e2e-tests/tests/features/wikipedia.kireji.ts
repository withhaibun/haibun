import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import Haibun from '@haibun/core/steps/haibun.js';

import { knowsAboutWikipedia, pagesVisited } from '../backgrounds/wikipedia-bg.kireji.ts';

const { ensure, forget } = withAction(new ActivitiesStepper());
const { is } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	'Visit pages': [
		feature({ feature: 'Visit pages' }),
		`Navigate Wikipedia and explore articles using Activities and Outcomes.
		This demonstrates using waypoint statements with interpolated parameters.
		The pattern 'Navigate to {page}' is defined once in the background.
		Each ensure call with a different page value (mainUrl, haibunUrl) creates a separate cached instance, tracked independently.`,

		'after every ActivitiesStepper, show var pagesVisited',

		scenario({scenario: 'Visit pages with parameterized outcomes'}),
		ensure({ outcome: knowsAboutWikipedia }),
		ensure({ outcome: 'Navigate to haibunUrl' }),
		`↑ Creates instance "Navigate to haibunUrl" under the "Navigate to {page}" pattern.`,

		forget({ outcome: 'Navigate to haibunUrl' }),
		ensure({ outcome: 'Navigate to mainUrl' }),
		`↑ Creates instance "Navigate to mainUrl" - a different cached outcome.`,

		forget({ outcome: 'Navigate to mainUrl' }),
		ensure({ outcome: 'Navigate to haibunUrl' }),
		`↑ Re-executes haibunUrl since we forgot it above.`,

		ensure({ outcome: 'Navigate to haibunUrl' }),
		`↑ Uses cached haibunUrl instance (no re-execution).`,

		is({ what: pagesVisited, value: '3' }),
		`↑ Verify three actual page visits (fourth ensure was cached).`,

		'show outcomes',
	]
}
