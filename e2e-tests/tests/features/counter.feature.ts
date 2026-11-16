import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";

import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import { page } from "@haibun/web-playwright/waypoints/backgrounds/page.feature.ts";

const { scenario } = withAction(new Haibun());
const { set, is } = withAction(new VariablesStepper());
const { setValue, click } = withAction(new WebPlaywright());

export const features: TKirejiExport = {
	"Counts feature": [
		scenario({ scenario: "Counter form submission" }),
		"Backgrounds: int/web-server, service/counter, int/counter",
		"This should pause eh.",
		"This scenario is written twice, here and as counter.feature, so the two ways of writing a feature are shown to describe one run. The two copies aren't redundant: together they are the only proof that gherkin and kireji express the same thing.",
		`set username to 10 random characters`,
		'serve files at "/static" from "counter"',
		'webserver is listening for "counter-ts"',
		'start tally route at "/count"',
		"go to the counter webpage",
		setValue({ what: "username", field: "user name" }),
		click({ target: "Submit" }),
		set({ what: "username parameter", value: "BrowserPage:0.query.username" }),
		is({ what: '"username parameter"', value: "username" }),
		`matches BrowserPage:0.uri with "{counter URI}*"`,
		page.see("username"),
		`variable BrowserPage:0.cookie.userid is username`,
	],
};
