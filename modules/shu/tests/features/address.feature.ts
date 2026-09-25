import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { typeNotHeld } from "../../build/view-query.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { gotoPage, waitFor } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { chooseGraphLabel } = createStepUI(wp);

const host = "http://localhost:8237";
const NOT_HELD = "Nonesuch";

const testIdSetup = flattenTestIds(SHU_TEST_IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"An address names a type": [
		feature({ feature: "An address outlives the run it was made in" }),

		...testIdSetup,

		scenario({ scenario: "Setup" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "address-test"',

		scenario({ scenario: "An address names a type this run doesn't hold" }),
		"An address can name a type the run it was made in held and this run doesn't. The page keeps the address, says which type this run doesn't hold, and offers the types it does.",
		gotoPage({ name: `"${host}/spa#?label=${NOT_HELD}"` }),
		setAs({ what: "notHeld", domain: "page-locator", value: `".error-banner:has-text('${typeNotHeld(NOT_HELD)}')"` }),
		waitFor({ target: "notHeld" }),
		...chooseGraphLabel(SEQ_PATH_LABEL),
		"save URI to chosenAddress",
		`matches chosenAddress with *label=${SEQ_PATH_LABEL}*`,
	],
};
