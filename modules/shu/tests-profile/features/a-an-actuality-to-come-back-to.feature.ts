import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import ShuStepper from "@haibun/shu/shu-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const earlierEvents = Array.from({ length: 6 }, (_, i) => setAs({ what: `earlierEvent${i}`, domain: "page-test-id", value: `"e${i}"` }));

export const features: TKirejiExport = {
	"An actuality to come back to": [
		feature({ feature: "An actuality to come back to" }),
		...testIdSetup,

		scenario({ scenario: "A reader opens actuality while it is happening" }),

		"A reader's browser keeps one profile across the actualities it watches, which is what makes a finished actuality readable later. This feature is the whole of an actuality of its own, and it is the one they will come back to: the page reads it while it happens, and what a page reads it holds, so this device holds its records. The group's other features are a second actuality on the same profile.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "an actuality to come back to"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		...earlierEvents,
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		"What the page read of this actuality is written to the device after the read, so the actuality ends only once the device lists it among the actualities it holds. An actuality that ended earlier wouldn't leave its records on the device. The feature waits for the list of actualities the device holds.",
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		waitFor({ target: IDS.CLIENT_CACHE.HELD }),
	],
};
