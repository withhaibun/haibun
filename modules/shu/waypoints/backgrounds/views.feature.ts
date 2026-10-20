import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { RAIL_EDGE_TITLE, SHU_TAG, TIME_SYNC_CLASS } from "@haibun/shu/domains/elements.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { RAIL_POSITION_MAX } from "@haibun/shu/page/derivations/rail.js";

/** A waypoint's placeholder for the view whose page it reads, which a feature names by its tag, quoted. */
const VIEW = "{view}";
/** The variable that holds the locator each activity composes, which it then waits for or presses. */
const TARGET = "shu view target";
const testId = (id: string): string => `[data-testid="${id}"]`;
const FRAME = SHU_TAG.ARTIFACT_FRAME;
/** The document column, quoted as a literal container. */
const DOCUMENT = `"${SHU_TAG.DOCUMENT_COLUMN}"`;

/** The heads of shu's view waypoints, which a feature states and each waypoint below declares. */
export const views = {
	showsRowFirst: (view: string, row: string) => `view ${view} shows row ${row} first`,
	showsLaterRowFirst: (view: string, row: string) => `view ${view} doesn't show row ${row} first`,
	showsRowContaining: (view: string, text: string) => `view ${view} shows a row containing ${text}`,
	isAtItsEnd: (view: string) => `view ${view} is scrolled to its end`,
	scrollToStart: (view: string) => `scroll view ${view} to its start`,
	scrollToEnd: (view: string) => `scroll view ${view} to its end`,
	railThumbTakesAPress: (view: string) => `rail thumb of view ${view} takes a press`,
	dimsRowsPastCursor: (view: string) => `view ${view} dims the rows past the time cursor`,
	moveCursorToFirstMoment: (view: string) => `move time cursor to the first moment of view ${view}`,
	documentShowsScreenshot: (ordinal: string) => `document shows screenshot ${ordinal}`,
	expandFirstScreenshot: () => "expand the first screenshot of the document",
	expandedScreenshotShowsItsStep: () => "expanded screenshot shows the step that took it",
	arrowKeyMovesExpandedScreenshot: () => "arrow key moves the expanded screenshot to the next",
	expandedScreenshotTakesAPress: () => "expanded screenshot takes a press, which closes it",
};

/** An activity that composes a locator from `selector` and runs `step` on it within `view`, stated as the waypoint `head`. */
const within = (activity: string, view: string, selector: string, step: "wait for" | "click", head: string): string[] => [
	`Activity: ${activity}`,
	`compose ${TARGET} as page-locator with ${selector}`,
	`in ${view}, ${step} ${TARGET}`,
	`waypoint ${head}`,
];

export const backgrounds: TKirejiExport = {
	"Shu views": [
		"A view's rail states the first row on screen at its head, which a reader reads as where the view is in the column.",
		...within("Read the first row on screen", "{view}", `${testId(SHU_TEST_IDS.SCROLLBAR.POS_TOP)}:text-is("{row}")`, "wait for", views.showsRowFirst(VIEW, "{row}")),
		...within("Read a later first row", "{view}", `${testId(SHU_TEST_IDS.SCROLLBAR.POS_TOP)}:not(:text-is("{row}"))`, "wait for", views.showsLaterRowFirst(VIEW, "{row}")),

		"A row a view shows holds text a reader reads.",
		...within("Read a row's text", "{view}", `:text("{text}")`, "wait for", views.showsRowContaining(VIEW, "{text}")),

		"A rail states its position as a scrollbar does to assistive technology, and states its maximum only where the view shows its last row.",
		...within("Read the rail's position", "{view}", `[role="scrollbar"][aria-valuenow="${RAIL_POSITION_MAX}"]`, "wait for", views.isAtItsEnd(VIEW)),

		"A reader presses the rail's position glyphs to reach the column's first or last row.",
		"Activity: Press the rail's start",
		`in {view}, click "${RAIL_EDGE_TITLE.start}" by title`,
		`waypoint ${views.scrollToStart(VIEW)}`,
		"Activity: Press the rail's end",
		`in {view}, click "${RAIL_EDGE_TITLE.end}" by title`,
		`waypoint ${views.scrollToEnd(VIEW)}`,

		"A reader grabs the rail's thumb to drag it, so a press at its middle reaches the thumb and not a mark drawn over it.",
		"Activity: Press the rail's thumb",
		`in {view}, click "${SHU_TEST_IDS.SCROLLBAR.THUMB}" by test id`,
		`waypoint ${views.railThumbTakesAPress(VIEW)}`,

		"A view that follows the time cursor dims each row recorded after the cursor's moment, and a row's moment moves the cursor.",
		...within("Read the dimmed rows", "{view}", `.${TIME_SYNC_CLASS.FUTURE}`, "wait for", views.dimsRowsPastCursor(VIEW)),
		...within("Press a row's moment", "{view}", `${testId(SHU_TEST_IDS.TIME_CURSOR.MOMENT)} >> nth=0`, "click", views.moveCursorToFirstMoment(VIEW)),

		"The document shows actuality's screenshots as tiles, each once the page has read its artifact. A reader expands one over the column, where it is captioned with the step that took it and the arrow keys move through actuality's screenshots.",
		...within("Read a screenshot", DOCUMENT, `:nth-match(${FRAME}.thumb img[src], {ordinal})`, "wait for", views.documentShowsScreenshot("{ordinal}")),
		...within("Expand a screenshot", DOCUMENT, `${FRAME}.thumb img >> nth=0`, "click", views.expandFirstScreenshot()),
		...within("Read the expanded caption", DOCUMENT, `${FRAME}.fullscreen .step-caption`, "wait for", views.expandedScreenshotShowsItsStep()),
		"Activity: Move to the next screenshot",
		`press "ArrowRight"`,
		`compose ${TARGET} as page-locator with ${FRAME}.fullscreen:not([data-frame-ordinal$=":0"])`,
		`in ${DOCUMENT}, wait for ${TARGET}`,
		`waypoint ${views.arrowKeyMovesExpandedScreenshot()}`,
		...within("Press the expanded screenshot", DOCUMENT, `${FRAME}.fullscreen img`, "click", views.expandedScreenshotTakesAPress()),
	],
};
