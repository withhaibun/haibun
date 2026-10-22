import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { DOMAIN_PAGE_TEST_ID } from "@haibun/web-playwright/domains.js";

/** The variable that holds the target each activity sets, which the activity's wait reads. */
const TARGET = "web page target";

/** The heads of web-playwright's waypoints, which a feature states and each waypoint below declares. */
export const page = {
	testIdIsGone: (testId: string) => `test id ${testId} is gone`,
};

export const backgrounds: TKirejiExport = {
	"Web pages": [
		"A page states that it doesn't show an element with a test id, in its document or a shadow root, once the element is detached or hidden.",
		"Activity: Wait until a test id is gone",
		`set ${TARGET} as ${DOMAIN_PAGE_TEST_ID} to {testId}`,
		`wait until ${TARGET} is gone`,
		`waypoint ${page.testIdIsGone("{testId}")}`,
	],
};
