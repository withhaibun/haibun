import type { TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import { RAIL_EDGE_TITLE, SETTINGS_GROUP, SHU_ATTR, SHU_TAG, TIME_SYNC_CLASS } from "@haibun/shu/domains/elements.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { RAIL_POSITION_MAX } from "@haibun/shu/page/derivations/rail.js";
import { READ_STATE } from "@haibun/shu/page/graph/domains/views.js";

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
/** The graph's reading, and each entry of it, which names the node it opens. */
const READING = testId(GRAPH.A11Y);
const ENTRY = `${READING} ol > li > [data-node-id="{id}"]`;
/** The way to the node an edge of an entry points at, by the edge's predicate. */
const EDGE = `${READING} ol ul li:text-matches("^{predicate} → ") > [data-node-id]`;
/** The scene picker's option for a scene, by its name. */
const SCENE_OFFERED = `${testId(GRAPH.SCENE_PICKER)}:has(option[value="{name}"])`;
/** A chip of the graph's filter, by the name it shows before its count. */
const CHIP = `${SHU_TAG.CHIP_GROUP} label.chip:text-matches("^{name}( |$)")`;
/** What an entry states of a node a focus or a preview dims. */
const DIMMED = `:has-text(", ${READ_STATE.dimmed})")`;
/** An activity that presses a toggle of `view` that `selector` locates while it states `from`, and waits for it to state the
 *  other, stated as the waypoint `head`. A press that doesn't reach the toggle fails the activity. */
const toggled = (activity: string, selector: string, from: boolean, head: string): string[] => [
	`Activity: ${activity}`,
	`compose ${TARGET} as page-locator with ${selector}[aria-pressed="${from}"]`,
	`in {view}, click ${TARGET}`,
	`compose ${TARGET} as page-locator with ${selector}[aria-pressed="${!from}"]`,
	`in {view}, wait for ${TARGET}`,
	`waypoint ${head}`,
];
/** The waypoints of a settings group, opened and closed by its icon on the graph's head. */
const settingsGroup = (group: (typeof SETTINGS_GROUP)[keyof typeof SETTINGS_GROUP]): string[] => [
	...toggled(`Open the graph's ${group} settings`, testId(GRAPH.SETTINGS[group]), false, views.openGraphSettings(VIEW, group)),
	...toggled(`Close the graph's ${group} settings`, testId(GRAPH.SETTINGS[group]), true, views.closeGraphSettings(VIEW, group)),
];

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
	controlShows: (view: string, control: string, value: string) => `control ${control} of view ${view} shows ${value}`,
	controlIsTicked: (view: string, control: string) => `control ${control} of view ${view} is ticked`,
	columnIsActive: (match: string) => `column ${match} is active`,
	activateColumn: (match: string) => `activate column ${match}`,
	closeColumn: (match: string) => `close column ${match}`,
	queryLists: (type: string, id: string) => `query lists the ${type} individual ${id}`,
	readAnEarlierTurn: () => "read an earlier turn in the chat",
	chatShowsItsNewestTurn: () => "chat shows its newest turn",
	graphListsNode: (view: string, id: string) => `graph ${view} lists node ${id}`,
	graphDoesntListNode: (view: string, id: string) => `graph ${view} doesn't list node ${id}`,
	graphListsNodes: (view: string, count: string) => `graph ${view} lists ${count} or more nodes`,
	showGraphReading: (view: string) => `show the reading of graph ${view}`,
	putAwayGraphReading: (view: string) => `put away the reading of graph ${view}`,
	openGraphNode: (view: string, id: string) => `open node ${id} in graph ${view}`,
	openGraphNodeNamed: (view: string, name: string) => `open the node named ${name} in graph ${view}`,
	openActiveGraphNode: (view: string) => `open the active node in graph ${view}`,
	graphNodeIsActive: (view: string, id: string) => `node ${id} of graph ${view} is active`,
	graphHasNoActiveNode: (view: string) => `graph ${view} doesn't show an active node`,
	graphNodeIsDimmed: (view: string, id: string) => `node ${id} of graph ${view} is dimmed`,
	graphNodeIsLit: (view: string, id: string) => `node ${id} of graph ${view} isn't dimmed`,
	graphDimsNodes: (view: string) => `graph ${view} dims the nodes outside its focus`,
	graphNodeReads: (view: string, id: string, label: string) => `node ${id} of graph ${view} reads ${label}`,
	graphNodeDoesntRead: (view: string, id: string, label: string) => `node ${id} of graph ${view} doesn't read ${label}`,
	graphShowsGroup: (view: string, title: string) => `graph ${view} shows group ${title}`,
	graphShowsNoGroup: (view: string) => `graph ${view} doesn't group its nodes`,
	graphReadsActor: (view: string, name: string) => `graph ${view} reads actor ${name}`,
	graphReadsEdge: (view: string, predicate: string) => `graph ${view} reads an edge ${predicate}`,
	graphDoesntReadEdge: (view: string, predicate: string) => `graph ${view} doesn't read an edge ${predicate}`,
	graphIsAtRest: (view: string) => `graph ${view} is at rest`,
	graphPlacesTasks: (view: string, count: string) => `graph ${view} places ${count} tasks on its calendar`,
	graphFollows: (view: string) => `graph ${view} follows its active node`,
	graphDoesntFollow: (view: string) => `graph ${view} doesn't follow its active node`,
	openGraphSettings: (view: string, group: string) => `open the ${group} settings of graph ${view}`,
	closeGraphSettings: (view: string, group: string) => `close the ${group} settings of graph ${view}`,
	saveGraphScene: (view: string, name: string) => `save the scene of graph ${view} as ${name}`,
	graphOffersScene: (view: string, name: string) => `graph ${view} offers scene ${name}`,
	returnGraphToScene: (view: string, name: string) => `return graph ${view} to scene ${name}`,
	toggleGraphChip: (view: string, name: string) => `toggle chip ${name} of graph ${view}`,
	graphChipIsTicked: (view: string, name: string) => `chip ${name} of graph ${view} is ticked`,
	graphChipIsntTicked: (view: string, name: string) => `chip ${name} of graph ${view} isn't ticked`,
	pointAtGraphChip: (view: string, name: string) => `point at chip ${name} of graph ${view}`,
	pointAtGraphHead: (view: string) => `point at the head of graph ${view}`,
	graphShowsAxioms: (view: string) => `graph ${view} shows its axioms beside the scene`,
	sourceLineLights: (view: string, line: string) => `line ${line} of the source of graph ${view} lights what it states`,
	enterInStepInput: (statement: string) => `enter ${statement} in the actions bar's step input`,
	runLastStepForm: () => "run the last step form in the actions bar",
};

/** The steps an activity runs on the locator it composes, each written before the locator but the scroll and the wait until gone. */
type TOnTarget = "wait for" | "click" | "hover over" | "scroll up a screen" | "wait until gone";
const onTarget = (step: TOnTarget): string => {
	if (step === "scroll up a screen") return `scroll ${TARGET} up a screen`;
	if (step === "wait until gone") return `wait until ${TARGET} is gone`;
	return `${step} ${TARGET}`;
};

/** An activity that composes a locator from `selector` and runs `step` on it within `view`, or within the page, stated as the
 *  waypoint `head`. */
const within = (activity: string, view: string, selector: string, step: TOnTarget, head: string): string[] => [
	`Activity: ${activity}`,
	`compose ${TARGET} as page-locator with ${selector}`,
	view === PAGE ? onTarget(step) : `in ${view}, ${onTarget(step)}`,
	`waypoint ${head}`,
];

/** The element of the actions bar's last step form whose test id ends with `suffix`. */
const lastStepForm = (suffix: string): string => `${SHU_TAG.STEP_CALLER}:last-of-type [data-testid$="-${suffix}"]`;

export const backgrounds: TKirejiExport = {
	"Shu views": [
		"The actions bar's step input takes a whole statement, such as set greeting to hello. It opens the form of the step the statement names, with the statement's values in its inputs, and the form runs that step.",
		"Activity: Enter a statement in the step input",
		`compose ${TARGET} as page-locator with ${testId(SHU_TEST_IDS.APP.STEP_SELECT)}`,
		`enter {statement} into ${TARGET}`,
		'press "Enter"',
		`compose ${TARGET} as page-locator with ${lastStepForm("step-run")}`,
		`wait for ${TARGET}`,
		`waypoint ${views.enterInStepInput("{statement}")}`,
		"Activity: Run the last step form",
		`compose ${TARGET} as page-locator with ${lastStepForm("step-run")}`,
		`click ${TARGET}`,
		`compose ${TARGET} as page-locator with ${lastStepForm("step-result")}`,
		`wait for ${TARGET}`,
		`waypoint ${views.runLastStepForm()}`,

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

		"A view's controls show what a reader chose: the option a select holds, and whether a box is ticked.",
		...within("Read a control's option", "{view}", `[data-testid="{control}"]:has(option[value="{value}"]:checked)`, "wait for", views.controlShows(VIEW, "{control}", "{value}")),
		...within("Read a ticked control", "{view}", `[data-testid="{control}"]:checked`, "wait for", views.controlIsTicked(VIEW, "{control}")),

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

		"A graph view reads the axioms of what it shows beside the scene, in Manchester syntax with their DL notation, a frame of Manchester syntax for each class, property and record, through the step that describes the graph on the server.",
		"Activity: Read a graph's axioms beside the scene",
		`in {view}, click "${GRAPH.SOURCE}" by test id`,
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SOURCE_LINES)} [role="option"] >> nth=0`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.graphShowsAxioms(VIEW)}`,
		"A line of the source lights the nodes and edges it states in the scene and frames them, and states what it lights to a reader who isn't looking at the scene.",
		"Activity: Press a line of a graph's source",
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SOURCE_LINES)} [data-name="{line}"]`,
		`in {view}, click ${TARGET}`,
		`compose ${TARGET} as page-locator with [role="status"]:text-matches("^{line} lights [1-9]")`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.sourceLineLights(VIEW, "{line}")}`,

		"A graph view reads its graph as a document beside the picture: an entry for each node it draws, which names the node as its chip reads, opens it, and states the node active, dimmed or pinned as the picture shows it, the title of each box it draws around a group, and each lifeline a view built on actors draws. The document is busy while what the graph shows still changes.",
		...within("Read a node of a graph", "{view}", ENTRY, "wait for", views.graphListsNode(VIEW, "{id}")),
		...within("Read that a graph doesn't draw a node", "{view}", ENTRY, "wait until gone", views.graphDoesntListNode(VIEW, "{id}")),
		...within("Read how many nodes a graph draws", "{view}", `:nth-match(${READING} ol > li > [data-node-id], {count})`, "wait for", views.graphListsNodes(VIEW, "{count}")),
		"Activity: Show a graph's reading",
		`in {view}, click "${GRAPH.READ}" by test id`,
		`compose ${TARGET} as page-locator with ${READING}[data-shown]`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.showGraphReading(VIEW)}`,
		"Activity: Put a graph's reading away",
		`in {view}, click "${GRAPH.READ}" by test id`,
		`compose ${TARGET} as page-locator with ${READING}[data-shown]`,
		`in {view}, wait until ${TARGET} is gone`,
		`waypoint ${views.putAwayGraphReading(VIEW)}`,
		...within("Open a node from a graph's reading", "{view}", ENTRY, "click", views.openGraphNode(VIEW, "{id}")),
		...within("Open a node by its name", "{view}", `${READING} ol > li > [data-node-id]:has-text("{name}") >> nth=0`, "click", views.openGraphNodeNamed(VIEW, "{name}")),
		...within("Open a graph's active node", "{view}", `${READING} ol > li > [aria-current="true"]`, "click", views.openActiveGraphNode(VIEW)),
		...within("Read a graph's active node", "{view}", `${ENTRY}[aria-current="true"]`, "wait for", views.graphNodeIsActive(VIEW, "{id}")),
		...within("Read that a graph doesn't show an active node", "{view}", `${READING} ol > li > [aria-current="true"]`, "wait until gone", views.graphHasNoActiveNode(VIEW)),
		...within("Read a dimmed node", "{view}", `${ENTRY}${DIMMED}`, "wait for", views.graphNodeIsDimmed(VIEW, "{id}")),
		...within("Read a lit node", "{view}", `${ENTRY}:not(${DIMMED})`, "wait for", views.graphNodeIsLit(VIEW, "{id}")),
		...within("Read that a graph dims what is outside its focus", "{view}", `${READING} ol > li > [data-node-id]${DIMMED}`, "wait for", views.graphDimsNodes(VIEW)),
		...within("Read what a node's chip reads", "{view}", `${ENTRY}:text-matches("^{label} [(]")`, "wait for", views.graphNodeReads(VIEW, "{id}", "{label}")),
		...within("Read that a node's chip reads otherwise", "{view}", `${ENTRY}:not(:text-matches("^{label} [(]"))`, "wait for", views.graphNodeDoesntRead(VIEW, "{id}", "{label}")),
		...within("Read a group's box", "{view}", `${testId(GRAPH.A11Y_GROUPS)} li:text-is("{title}")`, "wait for", views.graphShowsGroup(VIEW, "{title}")),
		...within("Read that a graph doesn't group its nodes", "{view}", testId(GRAPH.A11Y_GROUPS), "wait until gone", views.graphShowsNoGroup(VIEW)),
		...within("Read a lifeline", "{view}", `${testId(GRAPH.A11Y_LANES)} li:text-is("{name}")`, "wait for", views.graphReadsActor(VIEW, "{name}")),
		...within("Read an edge", "{view}", EDGE, "wait for", views.graphReadsEdge(VIEW, "{predicate}")),
		...within("Read that a graph doesn't draw an edge", "{view}", EDGE, "wait until gone", views.graphDoesntReadEdge(VIEW, "{predicate}")),
		...within("Read that a graph is at rest", "{view}", `${READING}[aria-busy="false"]`, "wait for", views.graphIsAtRest(VIEW)),
		"A view that gives its axes a meaning names it: the gantt names the calendar span its tasks are placed on and how many it places.",
		...within("Read the tasks a calendar places", "{view}", `${testId(GRAPH.AXIS_LEGEND)}:has-text("{count} tasks")`, "wait for", views.graphPlacesTasks(VIEW, "{count}")),

		"A graph's head shows which of its toggles are on and which settings group is open, and a group's icon opens and closes its row of controls.",
		...within("Read that a graph follows", "{view}", `${testId(GRAPH.FOLLOW)}[aria-pressed="true"]`, "wait for", views.graphFollows(VIEW)),
		...within("Read that a graph doesn't follow", "{view}", `${testId(GRAPH.FOLLOW)}[aria-pressed="false"]`, "wait for", views.graphDoesntFollow(VIEW)),
		...Object.values(SETTINGS_GROUP).flatMap(settingsGroup),

		"A graph's scenes group saves the way the graph is set up under a name, offers each scene saved anywhere, and returns the graph to the one a reader picks. The graph states the scene it was returned to once the return lands.",
		"Activity: Save a graph's scene",
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SCENE_NAME)}`,
		`in {view}, enter "{name}" into ${TARGET}`,
		`in {view}, click "${GRAPH.SCENE_SAVE}" by test id`,
		`compose ${TARGET} as page-locator with ${SCENE_OFFERED}`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.saveGraphScene(VIEW, "{name}")}`,
		...within("Read a scene a graph offers", "{view}", SCENE_OFFERED, "wait for", views.graphOffersScene(VIEW, "{name}")),
		"Activity: Return a graph to a scene",
		`compose ${TARGET} as page-locator with ${testId(GRAPH.SCENE_PICKER)}`,
		`in {view}, enter "{name}" into ${TARGET}`,
		`compose ${TARGET} as page-locator with ${SHU_TAG.POLYMORPHIC_GRAPH_VIEW}[${SHU_ATTR.SCENE}="{name}"]`,
		`in {view}, wait for ${TARGET}`,
		`waypoint ${views.returnGraphToScene(VIEW, "{name}")}`,

		"A graph's filter shows a chip for each type and predicate it draws, which a press toggles and the pointer previews, lighting what it names and dimming the rest.",
		...within("Toggle a chip", "{view}", CHIP, "click", views.toggleGraphChip(VIEW, "{name}")),
		...within("Read a ticked chip", "{view}", `${CHIP}:has(input:checked)`, "wait for", views.graphChipIsTicked(VIEW, "{name}")),
		...within("Read an unticked chip", "{view}", `${CHIP}:has(input:not(:checked))`, "wait for", views.graphChipIsntTicked(VIEW, "{name}")),
		...within("Point at a chip", "{view}", CHIP, "hover over", views.pointAtGraphChip(VIEW, "{name}")),
		...within("Point at the head", "{view}", testId(GRAPH.FIT), "hover over", views.pointAtGraphHead(VIEW)),

		"A reader who scrolls back through the chat's history leaves its newest turn, and the control that states what arrived meanwhile returns them to it and hides once they are there.",
		...within("Scroll the history back", PAGE, SHU_TAG.ACTIVITY_HISTORY, "scroll up a screen", views.readAnEarlierTurn()),
		"Activity: Read the newest turn",
		`compose ${TARGET} as page-locator with ${testId(SHU_TEST_IDS.APP.CHAT_ARRIVED)}`,
		`wait until ${TARGET} is gone`,
		`waypoint ${views.chatShowsItsNewestTurn()}`,
	],
};
