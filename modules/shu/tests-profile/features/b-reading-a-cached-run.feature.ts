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
const SOURCE_STATE = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}info-state`;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));


export const features: TKirejiExport = {
	"Reading a run the device cached": [
		feature({ feature: "Reading a run the device cached" }),
		...testIdSetup,

		scenario({ scenario: "The runs this device caches are listed, and an earlier one can be read" }),

		"This is a second run on the same reader's profile, so the device caches the earlier run beside the one being recorded now. The client cache view lists both, names each by the features it ran, and marks which the page is reading.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "reading a run the device cached"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to cachedRuns`,
		'matches cachedRuns with "*A run to come back to*"',
		`save text from ${IDS.CLIENT_CACHE.READING} to readingNow`,
		'matches readingNow with "*Reading a run the device cached*"',

		"Reading the run before it makes every event view read that one instead. It is not the run this server is recording, so its rows come from the device alone, and the monitor shows them.",
		click({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.READING} to readingEarlier`,
		'matches readingEarlier with "*A run to come back to*"',
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"A run the server is no longer recording is finished, and a reader of it is never told that a server could not be reached: there is no server that could have it. What can be read of it is what this device holds, and the report of the run carries all of it.",
		setAs({ what: SOURCE_STATE, domain: "page-test-id", value: `"${SOURCE_STATE}"` }),
		`save text from ${SOURCE_STATE} to earlierState`,
		'not matches earlierState with "*server could not be reached*"',
	],
};
