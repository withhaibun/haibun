import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import ShuMonitorColumnControls from "../../build/components/shu-monitor-column.controls.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, gotoPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { monitorShowsFewerThan, seekMonitorRail, monitorFirstVisibleRow, monitorFirstVisibleRowIsNot, documentShowsFewerThan } = withAction(new ShuMonitorColumnControls());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
// Buffer far more events than any viewport can hold, so a virtualized monitor renders only a small window of them.
const BULK_EVENTS = 200;
const bulkEvents = Array.from({ length: BULK_EVENTS }, (_, i) => setAs({ what: `windowEvent${i}`, domain: "page-test-id", value: `"v${i}"` }));

export const features: TKirejiExport = {
	"Monitor view collects and displays execution events": [
		feature({ feature: "Monitor stepper with live log stream and sequence diagram" }),

		...testIdSetup,

		scenario({ scenario: "Start shu with monitor stepper" }),
		"The monitor stepper buffers execution events and serves them via RPC.",
		"The show monitor step opens a log stream column in the SPA.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "monitor-test"',

		scenario({ scenario: "Buffer many execution events" }),
		"These buffered events fill the log so a small data window has something to truncate.",
		...bulkEvents,

		scenario({ scenario: "Open SPA and enter step mode" }),
		gotoPage({ name: `"${host}/spa"` }),
		...enterStepMode,

		scenario({ scenario: "Open monitor column via step" }),
		"The show monitor step triggers the SPA to open a monitor log stream column.",
		...passesStepExecution("MonitorStepper-showMonitor", {}),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		scenario({ scenario: "The monitor virtualizes the log to the viewport" }),
		"Every buffered event is in the log, but the monitor renders only the rows in view plus the virtualizer's small overscan, so the DOM stays small no matter how long the run.",
		monitorShowsFewerThan({ max: "150" }),

		scenario({ scenario: "The custom scroll rail drives the virtualized viewport" }),
		"The rail is not decoration: seeking it moves the window. Seek to the bottom and the first visible row is no longer row one; seek back to the top and it is row one again — proving a drag or click on the rail scrolls the virtualizer (a holey placeholder items array once made every seek a silent no-op).",
		seekMonitorRail({ where: '"bottom"' }),
		monitorFirstVisibleRowIsNot({ ordinal: '"1"' }),
		seekMonitorRail({ where: '"top"' }),
		monitorFirstVisibleRow({ ordinal: '"1"' }),

		scenario({ scenario: "Open sequence diagram via step" }),
		"The show sequence diagram step triggers the SPA to open a sequence diagram column.",
		...passesStepExecution("MonitorStepper-showSequenceDiagram", {}),
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),

		scenario({ scenario: "The run document virtualizes the same buffered log" }),
		"The document reads the same buffered events as prose. It too renders only the blocks in view (the windowTail cut is gone), so a long run stays a small DOM.",
		...passesStepExecution("MonitorStepper-showDocument", {}),
		documentShowsFewerThan({ max: "150" }),
	],
};
