import { withAction } from '@haibun/core/kireji/withAction.js';
import ActivitiesStepper from '@haibun/core/steps/activities-stepper.js';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

const { activity, forget } = withAction(new ActivitiesStepper());
const { set, combine, increment } = withAction(new VariablesStepper());

export const knowsAboutWikipedia = 'Knows about Wikipedia';
const enWikipedia = 'enWikipedia';
export const onMainPage = 'On the main webpage';
export const onHaibunPage = 'On the haibun webpage';
export const pagesVisited = 'pagesVisited';

export const backgrounds = {
	'Wikipedia Activities': [
		'Define reusable outcomes using web-playwright and variables.',
		'Outcomes can capture page state and navigate efficiently.',

		activity({ activity: knowsAboutWikipedia }),
		set({ what: enWikipedia, value: 'https://en.wikipedia.org/wiki/' }),
		combine({ p1: enWikipedia, p2: 'Haibun', what: 'haibunUrl' }),
		combine({ p1: enWikipedia, p2: 'Main_Page', what: 'mainUrl' }),
		set({ what: pagesVisited, value: '0' }),
		'show vars',
		`remember ${knowsAboutWikipedia} with set enWikipedia to https://en.wikipedia.org/wiki/`,

		activity({ activity: 'Navigate to page' }),
		increment({ what: pagesVisited }),
		'remember Navigate to {page} with go to the {page} webpage',

		activity({ activity: 'Navigate to Main page' }),
		forget({ outcome: onHaibunPage }),
		`remember ${onMainPage} with Navigate to mainUrl`,

		activity({ activity: 'Navigate to Haibun page' }),
		forget({ outcome: onMainPage }),
		`remember ${onHaibunPage} with Navigate to haibunUrl`,
	],
};
