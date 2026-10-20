import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { RAIL_EDGE_TITLE, SHU_TAG, TIME_SYNC_CLASS } from "@haibun/shu/domains/elements.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { RAIL_POSITION_MAX } from "@haibun/shu/page/derivations/rail.js";
import { VIEW_LABELS } from "@haibun/shu/page/graph/domains/views.js";

/** A waypoint's placeholder for the view whose page it reads, which a feature names by its tag, quoted. */
const VIEW = "{view}";
/** The variable that holds the locator each activity composes, which it then waits for or presses. */
const TARGET = "shu view target";
const testId = (id: string): string => `[data-testid="${id}"]`;
const FRAME = SHU_TAG.ARTIFACT_FRAME;
const PANE = SHU_TAG.COLUMN_PANE;
/** An activity that reads the whole page rather than one view. */
const PAGE = "the page";
/** The document column, quoted as a literal container. */
const DOCUMENT = `"${SHU_TAG.DOCUMENT_COLUMN}"`;
const GRAPH = SHU_TEST_IDS.POLYMORPHIC_VIEW;

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
	columnIsActive: (match: string) => `column ${match} is active`,
	activateColumn: (match: string) => `activate column ${match}`,
	closeColumn: (match: string) => `close column ${match}`,
	queryLists: (type: string, id: string) => `query lists the ${type} individual ${id}`,
	readAnEarlierTurn: () => "read an earlier turn in the chat",
	chatShowsItsNewestTurn: () => "chat shows its newest turn",
	graphDrawsSourceTerms: (view: string) => `graph ${view} draws the terms of its source beside the source`,
	sourceLineLights: (view: string, line: string) => `line ${line} of the source of graph ${view} lights what it states`,
};

/** The steps an activity runs on the locator it composes, each written before the locator but the scroll. */
type TOnTarget = "wait for" | "click" | "scroll up a screen";
const onTarget = (step: TOnTarget): string => (step === "scroll up a screen" ? `scroll ${TARGET} up a screen` : `${step} ${TARGET}`);

/** An activity that composes a locator from `selector` and runs `step` on it within `view`, or within the page, stated as the
 *  waypoint `head`. */
const within = (activity: string, view: string, selector: string, step: TOnTarget, head: string): string[] => [
	`Activity: ${activity}`,
	`compose ${TARGET} as page-locator with ${selector}`,
	view === PAGE ? onTarget(step) : `in ${view}, ${onTarget(step)}`,
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

		"Every view shows in a column of the strip, which its address segment names. A press on a column's label makes it the active column, and its close control removes it from the strip.",
		...within("Read the active column", PAGE, `${PANE}[active][data-column-key*="{match}"]`, "wait for", views.columnIsActive("{match}")),
		...within("Press a column's label", PAGE, `${PANE}[data-column-key*="{match}"] ${testId(SHU_TEST_IDS.COLUMN_PANE.LABEL)} >> nth=0`, "click", views.activateColumn("{match}")),
		"Activity: Close a column",
		`compose ${TARGET} as page-locator with ${PANE}[data-column-key*="{match}"]`,
		`in ${TARGET}, click "${SHU_TEST_IDS.COLUMN_PANE.CLOSE}" by test id`,
		`wait until ${TARGET} is gone`,
		`waypoint ${views.closeColumn("{match}")}`,

		"The query lists each individual it matches as a row that carries the individual's type and id.",
		...within("Read a listed individual", PAGE, `[data-persisted-as="{type}"][data-individual-id="{id}"]`, "wait for", views.queryLists("{type}", "{id}")),

		"A graph view reads its source as text beside the scene, through the step that projects what the graph shows on the server, and draws the terms of that source in place of its records.",
		"Activity: Draw a graph's terms beside its source",
		`in {view}, click "${GRAPH.SETTINGS.layout}" by test id`,
		`compose ${TARGET} as page-locator with ${testId(GRAPH.VIEW_TYPE)}`,
		`in {view}, select "${VIEW_LABELS.terms}" for ${TARGET}`,
		`in {view}, click "${GRAPH.SOURCE}" by test id`,
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SOURCE_LINES)} [role="option"] >> nth=0`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.graphDrawsSourceTerms(VIEW)}`,
		"A line of the source lights the nodes and edges it states in the scene and frames them, and states what it lights to a reader who isn't looking at the scene.",
		"Activity: Press a line of a graph's source",
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SOURCE_LINES)} [data-name="{line}"]`,
		`in {view}, click ${TARGET}`,
		`compose ${TARGET} as page-locator with [role="status"]:text-matches("^{line} lights [1-9]")`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.sourceLineLights(VIEW, "{line}")}`,

		"A reader who scrolls back through the chat's history leaves its newest turn, and the control that states what arrived meanwhile returns them to it and hides once they are there.",
		...within("Scroll the history back", PAGE, SHU_TAG.ACTIVITY_HISTORY, "scroll up a screen", views.readAnEarlierTurn()),
		"Activity: Read the newest turn",
		`compose ${TARGET} as page-locator with ${testId(SHU_TEST_IDS.APP.CHAT_ARRIVED)}`,
		`wait until ${TARGET} is gone`,
		`waypoint ${views.chatShowsItsNewestTurn()}`,
	],
};
