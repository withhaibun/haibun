import type { TKirejiExport } from "@haibun/core/kireji/withAction.js";

import { withAction } from "@haibun/core/kireji/withAction.js";
import Haibun from "@haibun/core/steps/haibun.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";

const { scenario } = withAction(new Haibun());
const { setRandom, matches } = withAction(new VariablesStepper());
const { setValue, click, URIQueryParameterIs, saveURIQueryParameter, seeText, cookieIs } = withAction(new WebPlaywright());

export const features: TKirejiExport = {
	"Counts feature": [
		scenario({ scenario: "Counter form submission" }),
		"Backgrounds: service/counter, int/counter",
		"This should pause eh.",
		"This scenario is written twice, here and as counter.feature, so the two ways of writing a feature are shown to describe one run. Neither copy is redundant: together they are the only proof that gherkin and kireji say the same thing.",
		setRandom({ what: "username", length: 10 }),
		'serve files at /static from "counter"',
		'webserver is listening for "counter-ts"',
		"start tally route at /count",
		"go to the counter webpage",
		setValue({ what: "username", field: "user name" }),
		click({ target: "Submit" }),
		URIQueryParameterIs({ what: "username", value: "username" }),
		saveURIQueryParameter({ what: "username", where: "username parameter" }),
		matches({ value: "WebPlaywright.currentURI", pattern: '"{counter URI}*"' }),
		seeText({ text: "username" }),
		cookieIs({ name: '"userid"', value: "username" }),
	],
};
