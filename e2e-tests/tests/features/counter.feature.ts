import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";

import { withAction } from '@haibun/core/kireji/withAction.js';
import Haibun from '@haibun/core/steps/haibun.js';
import WebPlaywright from '@haibun/web-playwright';
import VariablesStepper from '@haibun/core/steps/variables-stepper.js';

const { scenario } = withAction(new Haibun());
const { setRandom } = withAction(new VariablesStepper());
const { inputVariable, click, URIQueryParameterIs, saveURIQueryParameter, URIStartsWith, seeText, cookieIs } = withAction(new WebPlaywright());

export const features: TKirejiExport = {
	'Counts feature': [
		scenario({ scenario: 'Counter form submission' }),
		'Backgrounds: service/counter, int/counter',
		'This should pause eh.',
		setRandom({ what: 'username', length: 10 }),
		'serve files at /static from "counter"',
		'start tally route at /count',
		'go to the counter webpage',
		inputVariable({ what: 'username', field: 'user name' }),
		click({ target: 'Submit' }),
		URIQueryParameterIs({ what: 'username', value: 'username' }),
		saveURIQueryParameter({ what: 'username', where: 'username parameter' }),
		URIStartsWith({ start: 'counter URI' }),
		seeText({ text: 'username' }),
		cookieIs({ name: '"userid"', value: 'username' })
	]
}
