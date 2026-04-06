import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, stepTestIds, flattenTestIds } from "../../build/index.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, gotoPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const stepIdSetup = stepTestIds([]).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"Monitor view collects and displays execution events": [
		feature({ feature: "Monitor stepper with live log stream and sequence diagram" }),

		...testIdSetup,
		...stepIdSetup,

		scenario({ scenario: "Start shu with monitor stepper" }),
		"The monitor stepper buffers execution events and serves them via RPC.",
		"The show monitor step opens a log stream column in the SPA.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "monitor-test"',

		scenario({ scenario: "Open SPA and enter step mode" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		...enterStepMode,
		"debug step by step",

		scenario({ scenario: "Open monitor column via step" }),
		"The show monitor step triggers the SPA to open a monitor log stream column.",
		...passesStepExecution("show monitor", {}),
		"page has settled",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		scenario({ scenario: "Open sequence diagram via step" }),
		"The show sequence diagram step triggers the SPA to open a sequence diagram column.",
		...passesStepExecution("show sequence diagram", {}),
		"page has settled",
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),
	],
};
