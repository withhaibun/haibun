import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';
import Haibun from '@haibun/core/steps/haibun.js';

import { pagesVisited } from '../backgrounds/wikipedia-bg.feature.ts';

const { ensure } = withAction(new ActivitiesStepper());
const { is } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

export const features: TKirejiExport = {
	'Visit pages': [
		feature({ feature: 'Visit pages' }),
		`Navigate Wikipedia and explore articles using Activities and Waypoints.
		This demonstrates using waypoint statements with interpolated parameters.
		The pattern 'Navigate to {page}' is defined once in the background.
		Each ensure call with a different page value (mainUrl, haibunUrl) always checks the current state.`,

		'after every ActivitiesStepper, show waypoints',

		scenario({ scenario: 'Visit pages with parameterized waypoints' }),
		`↑ Ensures that Wikipedia base URL exists up.`,

		ensure({ outcome: 'Navigate to mainUrl' }),

		ensure({ outcome: 'Navigate to haibunUrl' }),

		ensure({ outcome: 'Navigate to haibunUrl' }),
		`↑ Re-ensures haibunUrl - since we're already there, proof passes without navigation.`,

		is({ what: pagesVisited, value: '2' }),
		`↑ Verify three actual page visits (fourth ensure was already satisfied).`,

		`Verify all HTTP requests went to Wikipedia/Wikimedia domains.`,
		`set of "Allowed domains" is ["wikipedia.org", "wikimedia.org"]`,
		`every host observed in http-trace hosts is some allowed in "Allowed domains" is that {host} matches "*{allowed}"`,
		`↑ All network traffic stayed within allowed domains.`,

		`every request observed in http-trace is variable {request}/status is less than 400`,
		`every request observed in http-trace is variable {request}/time is less than 5000`,
		`some request observed in http-trace is that {request}/url matches "*Haibun*"`
	]
}
