import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VoiceUITestStepper from "../../build/test/voice-ui-test-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { serveTestComponent } = withAction(new VoiceUITestStepper());
const { gotoPage, waitFor } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode } = createStepUI(wp);

const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const customTestIds = ["voice-ui-test-mic"].map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"UI extension propagation: domain ui → concern catalog → SPA actions bar": [
		feature({ feature: "ui extensions on a vertex domain render as custom elements in the SPA chat row" }),

		...testIdSetup,
		...customTestIds,

		scenario({ scenario: "Setup" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		serveTestComponent({}),
		'webserver is listening for "voice-ui-test"',

		scenario({ scenario: "Open the SPA and enter step mode" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		...enterStepMode,

		scenario({ scenario: "ui-extension custom element renders inside the actions bar chat row" }),
		"The test component, declared as a ui extension on the test domain, travels through the concern catalog to the SPA, which auto-loads it and renders it in the actions bar's chat-row slot. That slot is carried by the step and ask input modes, so the component's mic button appears once step mode is open.",
		waitFor({ target: "voice-ui-test-mic" }),
	],
};
