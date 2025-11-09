import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

import { knowsAboutWikipedia, onMainPage, onHaibunPage, pagesVisited, } from '../backgrounds/wikipedia-bg.kireji.ts';

const { ensure } = withAction(new ActivitiesStepper());
const { is } = withAction(new VariablesStepper());

const wikipediaFeature = [
	'Navigate Wikipedia and explore articles using Activities and Outcomes.',
	'This demonstrates using remember statements to define reusable outcomes.',
	'Use ensure to execute outcomes only once, even when called multiple times.',
	'Use forget to reset cached state when navigating between pages.',
	'Use Activity markers for narrative structure.',
	'Capture page state in variables to verify navigation.',
	'after every ActivityStepper, show var pagesVisited',

	ensure({ outcome: knowsAboutWikipedia }),

	ensure({ outcome: onHaibunPage }),

	ensure({ outcome: onMainPage }),

	ensure({ outcome: onHaibunPage }),
	`The previous onHaibunPage is remembered.`,
	ensure({ outcome: onHaibunPage }),

	'Verify we visited three pages; the first three are actual accesses, the third is remembered to be current.',
	is({ what: pagesVisited, value: '3' }),
];

export const features = {
	'Explore Wikipedia via Activities': wikipediaFeature,
};
