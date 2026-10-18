import { withAction } from "@haibun/core/kireji/derivations/withAction.js";
import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";

import { WEB_SERVER } from "./int/web-server.feature.ts";

const { activity, ensure } = withAction(new ActivitiesStepper());
const { set, compose, increment } = withAction(new VariablesStepper());

/** The web server route that serves the pages. */
export const PAGES_ROUTE = "/static";
/** The directory under the test files that holds the pages. */
export const PAGES_DIRECTORY = "page-visits";
export const knowsTheSitePages = "Knows the site pages";
export const pagesVisited = "pagesVisited";
export const haibunUrl = "haibunUrl";
const siteBase = "siteBase";

export const backgrounds: TKirejiExport = {
	"Page visit outcomes": [
		`Define reusable outcomes using web-playwright and variables.
		Outcomes can capture page state and navigate efficiently.`,

		activity({ activity: knowsTheSitePages }),
		set({ what: siteBase, value: `"${WEB_SERVER}${PAGES_ROUTE}/"` }),
		compose({ what: haibunUrl, template: `{${siteBase}}haibun.html` }),
		compose({ what: "mainUrl", template: `{${siteBase}}main.html` }),
		set({ what: pagesVisited, value: "0" }),
		`waypoint ${knowsTheSitePages} with variable ${siteBase} exists`,

		activity({ activity: "Navigate to any site page" }),
		ensure({ outcome: knowsTheSitePages }),
		increment({ what: pagesVisited }),
		"go to the {page} webpage",
		"waypoint Navigate to {page} with variable WebPlaywright.currentURI is {page}",
		`↑ Parameterized outcome - use with: ensure Navigate to mainUrl, ensure Navigate to haibunUrl.`,
	],
};
