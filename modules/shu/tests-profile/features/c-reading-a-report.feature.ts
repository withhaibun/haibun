import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import ShuStepper from "@haibun/shu/shu-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";
import ShuMonitorColumnControls from "../../build/controls/monitor-controls-stepper.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { monitorHoldsRows } = withAction(new ShuMonitorColumnControls());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const REPORT = "/tmp/haibun-shu-report.html";
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const reportedEvents = Array.from({ length: 8 }, (_, i) => setAs({ what: `reportedEvent${i}`, domain: "page-test-id", value: `"r${i}"` }));

export const features: TKirejiExport = {
	"Reading a report of this actuality": [
		feature({ feature: "Reading a report of this actuality" }),
		...testIdSetup,

		scenario({ scenario: "A report carries its actuality, and a page with no site reads it" }),

		"A report is this page with the actuality it reports carried inside it: the graph the actuality wrote, which is the actuality, and the site's declarations. Opened from a file, with no site to read anything from, the monitor shows the actuality's rows because it reads them the way it reads any actuality.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "reading a report of this actuality"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		...reportedEvents,
		monitorHoldsRows({ n: "8" }),
		`saves shu to "${REPORT}"`,

		"The same page, opened as a file: nothing it asks of a site is answered, and actuality is still there to read. The views it had open come back with it, and what the page carries is what they read.",
		gotoPage({ name: `"file://${REPORT}"` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		monitorHoldsRows({ n: "8" }),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to reportCache`,
		'matches reportCache with "*Actualities this device holds*"',
	],
};
