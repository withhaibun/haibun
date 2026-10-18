import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import ShuStepper from "@haibun/shu/shu-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
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
	"Reading an actuality this device holds": [
		feature({ feature: "Reading an actuality this device holds" }),
		...testIdSetup,

		scenario({ scenario: "The actualities this device holds are listed, and an earlier one can be read" }),

		"This is a second actuality on the same reader's profile, so this device holds the records of the earlier actuality beside the ones being written now. The client cache view lists both actualities, names each by the features it ran, and marks which the page is reading.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "reading an actuality this device holds"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		"The device is read after the view opens, so the list is waited for by the control that exists only once an earlier actuality is held, rather than read the moment the view attaches.",
		waitFor({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to cachedActualities`,
		'matches cachedActualities with "*An actuality to come back to*"',
		`save text from ${IDS.CLIENT_CACHE.READING} to readingNow`,
		'matches readingNow with "*Reading an actuality this device holds*"',

		"Reading the actuality before it makes every view of actuality read that one instead, from its newest feature. It is not the actuality this site is recording, so its rows come from the records this device holds, and the monitor shows them.",
		click({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.READING} to readingEarlier`,
		'matches readingEarlier with "*An actuality to come back to*"',
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"An actuality that a site isn't recording is finished, and reading it doesn't wait on a site. What can be read of it is what this device holds, and its source states that it has read it.",
		setAs({ what: SOURCE_LOADED, domain: "page-test-id", value: `"${SOURCE_LOADED}"` }),
		waitFor({ target: SOURCE_LOADED }),

		scenario({ scenario: "The time control returns the views to the actuality being recorded" }),

		"A reader who chose an earlier actuality returns to the actuality being recorded through the page's time control. Its control for now releases the moment they picked and the actuality they chose, so every view reads the actuality this site is recording again.",
		click({ target: IDS.APP.TIME_OFFSET }),
		click({ target: IDS.PLAYBACK.LIVE }),
		`save text from ${IDS.CLIENT_CACHE.READING} to readingAgain`,
		'matches readingAgain with "*Reading an actuality this device holds*"',
	],
};
