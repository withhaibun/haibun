import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VoiceUITestStepper from "../../build/test/voice-ui-test-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { flattenTestIds } from "../../build/index.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { serveTestComponent } = withAction(new VoiceUITestStepper());
const { gotoPage, click, waitFor } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

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

		scenario({ scenario: "Open SPA and expand the actions bar" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		waitFor({ target: IDS.APP.TWISTY }),
		click({ target: IDS.APP.TWISTY }),
		"page has settled",

		scenario({ scenario: "ui-extension custom element renders inside the actions bar chat row" }),
		// The voice-ui-test-component, declared by VoiceUITestStepper as a `ui`
		// extension on the VoiceUITest domain, must propagate through the concern
		// catalog (haibun-core) and be auto-loaded + rendered by the actions bar.
		// The slot is "action-bar-chat" — present in both step and ask modes.
		waitFor({ target: "voice-ui-test-mic" }),
	],
};
