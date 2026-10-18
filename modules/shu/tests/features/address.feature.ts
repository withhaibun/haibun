import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { SHU_TEST_IDS } from "../../build/domains/test-ids.js";
import { typeNotHeld } from "../../build/view-query.js";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { gotoPage, waitFor, click } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const host = "http://localhost:8237";
const NOT_HELD = "Nonesuch";
/** The link to the query of the step records, which the refusal offers. */
const HELD_STEPS = `${SHU_TEST_IDS.QUERY.HELD_TYPE}-${SEQ_PATH_LABEL}`;

const testIdSetup = flattenTestIds(SHU_TEST_IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"An address names a type": [
		feature({ feature: "An address outlives the actuality it was made in" }),

		...testIdSetup,

		scenario({ scenario: "Setup" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "address-test"',

		scenario({ scenario: "An address names a type actuality doesn't hold" }),
		"An address can name a type that an earlier actuality held and this actuality doesn't. The page keeps the address, states that actuality doesn't hold the type, and links the query of each type actuality holds. Following the link of the step records opens their query.",
		gotoPage({ name: `"${host}/spa#?label=${NOT_HELD}"` }),
		setAs({
			what: "notHeld",
			domain: "page-locator",
			value: `"[data-testid='${SHU_TEST_IDS.REFUSAL.CAUSE}']:has-text('${typeNotHeld(NOT_HELD, []).error.replaceAll("'", "\\'")}')"`,
		}),
		waitFor({ target: "notHeld" }),
		setAs({ what: HELD_STEPS, domain: "page-test-id", value: `"${HELD_STEPS}"` }),
		click({ target: HELD_STEPS }),
		"save URI to chosenAddress",
		`matches chosenAddress with "*label=${SEQ_PATH_LABEL}*"`,
	],
};
