/** The web-playwright waypoints: what a page shows, holds and waits for, read through the locator domains' properties.
 *  Each activity sets the `web page target` variable to its argument, typed as the domain whose properties it reads, and
 *  proves the property; a feature's line states the head sentence, which resolves to the activity. `wait for` and
 *  `wait until … is gone` are steps themselves: they hold the target's domain, which a waypoint's set couldn't keep. */
import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TEST_ID } from "@haibun/web-playwright/domains.js";

/** The variable that holds the target each activity sets, which the activity's read of it proves. */
const TARGET = "web page target";
/** How long an activity's wait lets the page take: the timeout a browser step takes by default. */
const WAIT = "30s";

/** The phrases a feature states, each one an activity below or one of web-playwright's wait steps. */
export const page = {
	see: (text: string) => `see ${text}`,
	hasTestId: (testId: string) => `has test id ${testId}`,
	waitFor: (target: string) => `wait for ${target}`,
	waitForUri: (pattern: string) => `wait until URI matches ${pattern}`,
	waitForGone: (target: string) => `wait until ${target} is gone`,
	testIdIsGone: (testId: string) => `test id ${testId} is gone`,
};

export const backgrounds: TKirejiExport = {
	"Web pages": [
		"A page states what it shows, what it holds, and what it waits for, each read of an element made through the properties of the domain that locates it.",
		"Activity: See the text on the page's body",
		"The body's text holds the text, read in place: only the verdict and the text's length cross to the step.",
		`set ${TARGET} as ${DOMAIN_PAGE_LOCATOR} to "body"`,
		`variable ${TARGET}.text contains {text}`,
		`waypoint ${page.see("{text}")}`,
		"Activity: Hold where the page holds an element with the test id",
		`An element the test id locates counts more than zero, the test id matched exactly.`,
		`set ${TARGET} as ${DOMAIN_PAGE_TEST_ID} to {testId}`,
		`variable ${TARGET}.count is more than "0"`,
		`waypoint ${page.hasTestId("{testId}")}`,
		"Activity: Wait until the address of the browser page matches",
		`The wait proves the tab's address against the pattern, and fails where it doesn't match in time.`,
		`until matches BrowserPage:0.uri with {pattern} within "${WAIT}"`,
		`waypoint ${page.waitForUri("{pattern}")}`,
		"Activity: Wait until a test id is gone",
		`The wait proves the element the test id locates, matched exactly, stops showing, and fails where it is still shown in time.`,
		`set ${TARGET} as ${DOMAIN_PAGE_TEST_ID} to {testId}`,
		`until variable ${TARGET}.visible is "false" within "${WAIT}"`,
		`waypoint ${page.testIdIsGone("{testId}")}`,
	],
};
