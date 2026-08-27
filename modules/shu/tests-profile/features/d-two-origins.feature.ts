import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const wp = new WebPlaywright();
const { waitFor, gotoPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const PORT = "8241";
const firstAddress = `http://localhost:${PORT}`;
const otherAddress = `http://127.0.0.1:${PORT}`;
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"What a reader holds is held per address": [
		feature({ feature: "What a reader holds is held per address" }),
		...testIdSetup,

		scenario({ scenario: "A reader at one address holds the runs they read there" }),

		"What a reader holds of a run is held by their browser under the address they read it at, and a browser keeps one reader's storage apart from another's by that address. This is what keeps two readers of two deployments from seeing each other's runs, and it is the browser that does it rather than anything written here.",
		"This run and the ones before it were all read at the same address on this profile, so the cache view there lists the earlier ones by what they ran.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "what a reader holds is held per address"',
		gotoPage({ name: `"${firstAddress}/spa"` }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to atFirstAddress`,
		'matches atFirstAddress with "*A run to come back to*"',

		scenario({ scenario: "The same server at another of its addresses holds nothing of them" }),

		"The same server, reached at another of its own addresses, is another address to the browser: what was read at the first is not there to be read. The reader is not shown an earlier run, because on this address they have read none. Nothing was moved or hidden to arrange that.",
		gotoPage({ name: `"${otherAddress}/spa"` }),
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.ROOT} to atOtherAddress`,
		"The reader is reading here, and holds this run: what is absent is the earlier runs, not the view.",
		'matches atOtherAddress with "*What a reader holds is held per address*"',
		'not matches atOtherAddress with "*A run to come back to*"',
	],
};
