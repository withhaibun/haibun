import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import WebServerStepper from "@haibun/web-server-hono/web-server-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import ShuStepper from "@haibun/shu/shu-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { configuredServiceHost, createStepUI, flattenTestIds, signedInAddress } from "@haibun/shu/test/step-ui.js";

const webPlaywright = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { asksToSignIn: everyVisitorSignsIn } = withAction(new WebServerStepper());
const { gotoPage, waitFor } = withAction(webPlaywright);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { chooseGraphLabel } = createStepUI(webPlaywright);

const APP = "/spa";
const host = configuredServiceHost();
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"A page behind basic auth": [
		feature({ feature: "A page behind a site's basic auth opens once its visitor signs in, and reads through the sign-in" }),

		"A site may require every visitor to sign in with HTTP basic auth, at a proxy in front of the instance or at the instance itself. The web server's BASIC_AUTH option names the people it admits, and it refuses every other request before a route reads it.",

		...testIdSetup,

		scenario({ scenario: "The instance refuses every request that doesn't sign in" }),
		"enable rpc",
		serveShuApp({ path: `"${APP}"` }),
		'webserver is listening for "behind-basic-auth-test"',
		"A request that doesn't sign in is refused before the instance reads it. A service checks this of each address that reaches it over TLS, and stops where an address responds without requiring a sign-in.",
		everyVisitorSignsIn({ address: `"${host}${APP}"` }),

		scenario({ scenario: "A person signs in, and the page opens and reads actuality's steps" }),
		"The browser keeps the sign-in for the site's other requests, so each call the page makes carries it, and the page lists the records of actuality's steps.",
		gotoPage({ name: `"${signedInAddress(host)}${APP}"` }),
		waitFor({ target: IDS.APP.ROOT }),
		...chooseGraphLabel(SEQ_PATH_LABEL),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),
	],
};
