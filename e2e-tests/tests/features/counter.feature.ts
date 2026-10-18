import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";

const { scenario } = withAction(new Haibun());
const { setRandom, matches, is } = withAction(new VariablesStepper());
const { setValue, click, saveURIQueryParameter, seeText, cookieIs } = withAction(new WebPlaywright());

export const features: TKirejiExport = {
	"Counts feature": [
		scenario({ scenario: "Counter form submission" }),
		"Backgrounds: int/web-server, service/counter, int/counter",
		"This should pause eh.",
		"This scenario is written twice, here and as counter.feature, so the two ways of writing a feature are shown to describe one run. The two copies aren't redundant: together they are the only proof that gherkin and kireji express the same thing.",
		setRandom({ what: "username", length: 10 }),
		'serve files at "/static" from "counter"',
		'webserver is listening for "counter-ts"',
		'start tally route at "/count"',
		"go to the counter webpage",
		setValue({ what: "username", field: "user name" }),
		click({ target: "Submit" }),
		saveURIQueryParameter({ what: "username", where: "username parameter" }),
		is({ what: '"username parameter"', value: "username" }),
		matches({ value: "WebPlaywright.currentURI", pattern: '"{counter URI}*"' }),
		seeText({ text: "username" }),
		cookieIs({ name: '"userid"', value: "username" }),
	],
};
