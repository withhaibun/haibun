import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";

import { WEB_SERVER } from "../backgrounds/int/web-server.feature.ts";
import { haibunUrl, knowsTheSitePages, PAGES_DIRECTORY, PAGES_ROUTE, pagesVisited } from "../backgrounds/page-visits-bg.feature.ts";

const { ensure } = withAction(new ActivitiesStepper());
const { is } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());

const ALLOWED_HOSTS = "Allowed hosts";
const SITE_HOST = new URL(WEB_SERVER).hostname;

export const features: TKirejiExport = {
	"Visit pages": [
		feature({ feature: "Visit pages" }),
		`This feature navigates the pages its own web server serves, with Activities and Waypoints.
		after every WebPlaywright, take a screenshot
		The feature uses waypoint statements with interpolated parameters.
		The pattern 'Navigate to {page}' is defined once in the background.
		Each ensure call checks the browser's current URI against its page value first. The calls pass mainUrl and haibunUrl as page values.`,

		"after every ActivitiesStepper, show the applicable steps",

		scenario({ scenario: "Visit pages with parameterized waypoints" }),
		`serve files at "${PAGES_ROUTE}" from "${PAGES_DIRECTORY}"`,
		`webserver is listening for "page visits"`,
		ensure({ outcome: knowsTheSitePages }),
		`↑ Sets the page addresses. Each call below passes one of them as its argument.`,

		ensure({ outcome: "Navigate to mainUrl" }),

		ensure({ outcome: "Navigate to haibunUrl" }),

		ensure({ outcome: "Navigate to haibunUrl" }),
		`↑ Re-ensures haibunUrl. The browser already shows that page, so the proof passes without navigation.`,

		is({ what: pagesVisited, value: "2" }),
		`↑ Verifies two page visits. The second ensure of haibunUrl passes its proof without a visit.`,

		`The next steps verify that every HTTP request reached the host of the feature's web server.`,
		`set of "${ALLOWED_HOSTS}" is ["${SITE_HOST}"]`,
		`every host observed in http-trace hosts is some allowed in "${ALLOWED_HOSTS}" is matches {host} with "{allowed}"`,
		`↑ Every host in the HTTP trace matches an allowed host.`,

		`every request observed in http-trace is variable request/status is less than 400`,
		`every request observed in http-trace is variable request/durationMs is less than 5000`,
		`some request observed in http-trace is matches request/url with "{${haibunUrl}}"`,
	],
};
