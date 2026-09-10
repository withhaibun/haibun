import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { waitFor, click, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const host = "http://localhost:8241";
const IDS = SHU_TEST_IDS;
const OLDEST_FORGET = "oldest-run-forget";
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"Forgetting a run this device holds": [
		feature({ feature: "Forgetting a run this device holds" }),
		...testIdSetup,
		setAs({ what: OLDEST_FORGET, domain: "page-locator", value: `"[data-testid^='${IDS.CLIENT_CACHE.RUN}'][data-testid$='-forget'] >> nth=-1"` }),

		scenario({ scenario: "A reader forgets the oldest run this device holds" }),

		"A device holds every run a reader has read at this address, and a reader removes one of them by forgetting it. The list carries a forget control on every run but the one being read, so a reader never deletes what a view is drawing. The oldest run this device holds is the first of these runs, and the earlier ones are listed with it.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "forgetting a run this device holds"',
		gotoPage({ name: `"${host}/spa"` }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		"The device is read after the view opens, so the list is waited for by the control that exists only once an earlier execution is held.",
		waitFor({ target: IDS.CLIENT_CACHE.READ_EARLIER }),
		`save text from ${IDS.CLIENT_CACHE.HELD} to heldBefore`,
		'matches heldBefore with "*A run to come back to*"',

		"Forgetting a run deletes its records from this device. The view reports what went once it has read the executions again, so what a reader sees after the deletion is what the device holds. The forgotten run is no longer listed, and the runs read after it are still there.",
		click({ target: OLDEST_FORGET }),
		waitFor({ target: IDS.CLIENT_CACHE.FORGOTTEN }),
		`save text from ${IDS.CLIENT_CACHE.HELD} to heldAfter`,
		'not matches heldAfter with "*A run to come back to*"',
		'matches heldAfter with "*Reading an execution this device holds*"',
	],
};
