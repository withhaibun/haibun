import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const runEvents = Array.from({ length: 6 }, (_, i) => setAs({ what: `earlierRunEvent${i}`, domain: "page-test-id", value: `"e${i}"` }));

export const features: TKirejiExport = {
	"A run to come back to": [
		feature({ feature: "A run to come back to" }),
		...testIdSetup,

		scenario({ scenario: "A reader opens the run while it is happening" }),

		"A reader's browser keeps one profile across the runs it watches, which is what makes a finished run readable later. This run is the one they will come back to: the page reads it while it happens, so their device caches it under this run's own name.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "a run to come back to"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		...runEvents,
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),
	],
};
