import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
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
const OLDEST_DELETE = "oldest-actuality-delete";
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"Deleting an actuality this device holds": [
		feature({ feature: "Deleting an actuality this device holds" }),
		...testIdSetup,
		setAs({ what: OLDEST_DELETE, domain: "page-locator", value: `"[data-testid^='${IDS.CLIENT_CACHE.ACTUALITY}'][data-testid$='-delete'] >> nth=-1"` }),

		scenario({ scenario: "A reader deletes the oldest actuality this device holds" }),

		"A device holds every actuality a reader has read at this address, and a reader removes one of them by deleting it. The list carries a delete control on every actuality but the one being read, so a reader never deletes what a view is drawing. The oldest actuality this device holds is the group's first, and it is listed with the one being read.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "deleting an actuality this device holds"',
		gotoPage({ name: `"${host}/spa"` }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		"The device is read after the view opens, so the list is waited for by the control that exists only once an earlier actuality is held.",
		waitFor({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.HELD} to heldBefore`,
		'matches heldBefore with "*An actuality to come back to*"',

		"Deleting an actuality removes its records from this device: its own record and the records of every feature, scenario and step it ran. The view reports what went once it has read the actualities again, so what a reader sees after the deletion is what the device holds. The deleted actuality is no longer listed, and the actuality read after it is still there.",
		click({ target: OLDEST_DELETE }),
		waitFor({ target: IDS.CLIENT_CACHE.DELETED }),
		`save text from ${IDS.CLIENT_CACHE.HELD} to heldAfter`,
		'not matches heldAfter with "*An actuality to come back to*"',
		'matches heldAfter with "*Reading an actuality this device holds*"',
	],
};
