import { withAction } from '@haibun/core/kireji/withAction.js';
import type { TKirejiExport } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

const { activity, ensure } = withAction(new ActivitiesStepper());
const { set, compose, increment } = withAction(new VariablesStepper());

export const knowsAboutWikipedia = 'Knows about Wikipedia';
const enWikipedia = 'enWikipedia';
export const pagesVisited = 'pagesVisited';

export const backgrounds: TKirejiExport = {
	'Page visit outcomes': [
		`Define reusable outcomes using web-playwright and variables.
		Outcomes can capture page state and navigate efficiently.`,

		activity({ activity: knowsAboutWikipedia }),
		set({ what: enWikipedia, value: 'https://en.wikipedia.org/wiki/' }),
		compose({ what: 'haibunUrl', template: '{enWikipedia}Haibun' }),
		compose({ what: 'mainUrl', template: '{enWikipedia}Main_Page' }),
		set({ what: pagesVisited, value: '0' }),
		`waypoint ${knowsAboutWikipedia} with variable enWikipedia exists`,

		activity({ activity: 'Navigate to any Wikipedia page' }),
		ensure({ outcome: knowsAboutWikipedia }),
		increment({ what: pagesVisited }),
		'go to the {page} webpage',
		'waypoint Navigate to {page} with variable WebPlaywright.currentURI is {page}',
		`↑ Parameterized outcome - use with: ensure Navigate to mainUrl, ensure Navigate to haibunUrl.`,
	],
};
