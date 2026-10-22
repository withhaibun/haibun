import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";
import { requiredModuleOption } from "@haibun/core/lib/held-module-options.js";
import { MONITOR_PATH } from "@haibun/shu/monitor-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { flattenTestIds } from "@haibun/shu/test/step-ui.js";

const { waitFor, gotoPage } = withAction(new WebPlaywright());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

/** The port the monitor serves on, which this feature opens. */
const MONITOR = `${localOrigin(Number(requiredModuleOption("HAIBUN_O_MONITORSTEPPER_PORT")))}${MONITOR_PATH}`;
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"The monitor serves shu on a port of its own": [
		feature({ feature: "The monitor serves shu on a port of its own" }),
		...testIdSetup,

		scenario({ scenario: "A reader opens the monitor's address" }),
		"A monitor that is given a port serves shu for the features being run, on a server of its own, so a feature doesn't serve shu to be read. A reader who opens the monitor's address without naming a view is shown the monitor, beside the list of the actualities this device holds.",
		gotoPage({ name: `"${MONITOR}"` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
	],
};
