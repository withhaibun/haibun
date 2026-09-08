import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { waitFor, click, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const SOURCE_LOADED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}info-loaded`;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));


export const features: TKirejiExport = {
	"Reading an execution this device holds": [
		feature({ feature: "Reading an execution this device holds" }),
		...testIdSetup,

		scenario({ scenario: "The executions this device holds are listed, and an earlier one can be read" }),

		"This is a second run on the same reader's profile, so this device holds the records of the earlier run beside the ones being written now. The client cache view lists both executions, names each by the features it ran, and marks which the page is reading.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "reading an execution this device holds"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		"The device is read after the view opens, so the list is waited for by the control that exists only once an earlier execution is held, rather than read the moment the view attaches.",
		waitFor({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to cachedRuns`,
		'matches cachedRuns with "*A run to come back to*"',
		`save text from ${IDS.CLIENT_CACHE.READING} to readingNow`,
		'matches readingNow with "*Reading an execution this device holds*"',

		"Reading the execution before it makes every view of the run read that one instead. It is not the execution this site is recording, so its rows come from the records this device holds, and the monitor shows them.",
		click({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.READING} to readingEarlier`,
		'matches readingEarlier with "*A run to come back to*"',
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"An execution no site is recording is finished, and reading it is not waiting on a site that could have it: what can be read of it is what this device holds, and the source of it says it has read it.",
		setAs({ what: SOURCE_LOADED, domain: "page-test-id", value: `"${SOURCE_LOADED}"` }),
		waitFor({ target: SOURCE_LOADED }),
	],
};
