import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";
import ShuMonitorColumnControls from "../../build/components/shu-monitor-column.controls.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { monitorTotalAtLeast } = withAction(new ShuMonitorColumnControls());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const REPORT = "/tmp/haibun-shu-report.html";
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const runEvents = Array.from({ length: 8 }, (_, i) => setAs({ what: `reportedEvent${i}`, domain: "page-test-id", value: `"r${i}"` }));

export const features: TKirejiExport = {
	"Reading a report of this run": [
		feature({ feature: "Reading a report of this run" }),
		...testIdSetup,

		scenario({ scenario: "A report carries its run, and a page with no server reads it" }),

		"A report is this page with the run it reports carried inside it: the events, what each level spans, and the site's declarations. Opened from a file, with no server to read anything from, the monitor shows the run's rows because it reads them the way it reads any run.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "reading a report of this run"',
		gotoPage({ name: `"${host}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		...runEvents,
		monitorTotalAtLeast({ n: "8" }),
		`saves shu to "${REPORT}"`,

		"The same page, opened as a file: nothing it asks of a server is answered, and the run is still there to read. The views it had open come back with it, and what the page carries is what they read.",
		gotoPage({ name: `"file://${REPORT}"` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		monitorTotalAtLeast({ n: "8" }),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to reportCache`,
		'matches reportCache with "*events cached for this run*"',
	],
};
