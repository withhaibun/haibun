import { withAction, type TKirejiExport } from "@haibun/core/kireji/derivations/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import ShuStepper from "@haibun/shu/shu-stepper.js";
import { SHU_TEST_IDS } from "@haibun/shu/domains/test-ids.js";
import { SHU_TAG } from "@haibun/shu/domains/elements.js";
import { createStepUI, flattenTestIds } from "@haibun/shu/test/step-ui.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";
import { headingAnchor } from "@haibun/core/lib/document-content.js";

const wp = new WebPlaywright();
const { waitFor, click, gotoPage, reloadPage, inElement } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { set, setAs, exists, setFromStatement } = withAction(new VariablesStepper());
const { comment } = withAction(new ResourcesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution, chooseGraphLabel } = createStepUI(wp);

const host = "http://localhost:8239";
const IDS = SHU_TEST_IDS;
/** Every open virtualized column has its own rail. This tag scopes a press on a rail to the document column. */
const DOC_CONTAINER = SHU_TAG.DOCUMENT_COLUMN;
const MONITOR_CONTAINER = SHU_TAG.MONITOR_COLUMN;
/** The test id of this feature's heading block in the document. The document builds the same id from the feature name with headingAnchor. */
const FEATURE_HEADING = `${SHU_TEST_IDS.DOCUMENT.HEADING}${headingAnchor("Shu SPA Self-Test")}`;
// The client cache view's cells for the log-level run source: its cached spans, its event count and its loaded state. The document reads at log level.
const CACHE_LOG_CACHED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-cached`;
const CACHE_LOG_EVENTS = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-events`;
const CACHE_LOG_LOADED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-loaded`;
/** The state cell of the same source when the source has loaded and the stream is disconnected. A source in that state doesn't report itself loaded. */
const CACHE_LOG_DISCONNECTED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-disconnected`;
/** Globs that match every request this page sends to its server: each RPC call and the event stream. */
const RPC_GLOB = "**/rpc/**";
const STREAM_GLOB = "**/sse*";
/** The monitor's pane. Every open column has the same pane controls, so a click on a control is scoped to this pane. */
const MONITOR_PANE = `shu-column-pane[column-type="${SHU_TAG.MONITOR_COLUMN}"]`;
const CHAIN_PANE = `shu-column-pane:has(${SHU_TAG.DOMAIN_CHAIN_VIEW})`;
const MAIN_GRAPH_PANE = `shu-column-pane:has(${SHU_TAG.POLYMORPHIC_GRAPH_VIEW}:not([data-external]))`;
/** The canvas of the graph view that the domain chain view mounts in its graph slot. */
const CHAIN_GRAPH_CANVAS = "chain-graph-canvas";
const CHAIN_GRAPH_CANVAS_SELECTOR = `${SHU_TAG.DOMAIN_CHAIN_VIEW} > [slot='${IDS.DOMAIN_CHAIN.GRAPH}'] [data-testid='${IDS.POLYMORPHIC_VIEW.SCENE}'] canvas`;
/** The views picker's list of declared views, and its row that opens the monitor column. */
const VIEWS_PICKER = SHU_TEST_IDS.VIEWS_PICKER.ROOT;
const VIEWS_PICKER_MONITOR = `${SHU_TEST_IDS.VIEWS_PICKER.ROW}${SHU_TAG.MONITOR_COLUMN}`;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
// createStepUI's helpers emit a setAs step for each step-caller test id they use. Each id holds the method and the call index. An input's id also holds its parameter.
// This list holds the registrations made at file scope. This file doesn't register one, so the list is empty.
const stepIdSetup: ReturnType<typeof setAs>[] = [];

const FRAGMENT = "ISECRET";
export const SECRETS = { FRAGMENT, TEST_PASSWORD: `${FRAGMENT}_shu_test` };

export const features: TKirejiExport = {
	"Shu SPA Self-Test": [
		feature({ feature: "Shu SPA Self-Test" }),

		"This feature drives the shu SPA in a browser through the steps a person takes. It opens the views, uses the affordances, resolves goals, reloads the page and checks that the reload restores the views. Each scenario states the behaviour it checks. A reader can follow the system from the scenarios without reading the implementation.",
		"The document view renders actuality's events and embeds each step's screenshot in the step's row. The next step takes a screenshot after each WebPlaywright step.",
		"This deployment doesn't register a delegation verifier. It allows every action without a delegation, so it allows each call the page sends. The page doesn't sign its calls.",
		"after every WebPlaywright, take a screenshot",
		...testIdSetup,
		...stepIdSetup,

		scenario({ scenario: "Start the server and write sample variables and comments" }),

		"A haibun server serves the SPA and exposes each stepper step as an RPC method. This scenario sets variables and writes comments for the later scenarios to read.",
		"enable rpc",
		'saves shu to "/tmp/shu.html"',
		serveShuApp({ path: '"/haibun"' }),
		`webserver is listening for "shu-self-test"`,
		"The set steps write variables. Each comment step writes a Comment record and asserts a fact of its products domain. The graph view and the column browser show the Comment records. The affordances panel shows a goal as satisfied where working memory holds a fact of the goal's domain.",
		set({ what: "secret-password", value: `"${SECRETS.TEST_PASSWORD}"` }),
		set({ what: "test-subject-1", value: '"Haibun test subject"' }),
		set({ what: "test-subject-2", value: '"Second test subject"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-1"', text: '"First comment"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-1"', text: '"Second comment"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-2"', text: '"Comment on second subject"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-2"', text: '"Final comment"' }),

		scenario({ scenario: "Open the SPA in a browser and confirm it loads" }),

		"The server serves the SPA at /haibun. Loading that address starts the shu app shell. The shell connects to /sse for live events and to /rpc for step calls. A bundle that fails to register its web components makes the later waitFor steps time out. That timeout is how this feature reports the failure.",
		gotoPage({ name: `"${host}/haibun"` }),

		scenario({ scenario: "Open the monitor column" }),

		"The monitor column renders actuality's records as a log with one row for each step. It reads the records again after the event stream sends an event. The log's toolbar on the page shows that the column mounted.",
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"The monitor shows a step's screenshot on that step's row. The screenshot doesn't get a row of its own, so a step and its product are read together. Actuality takes a screenshot after each WebPlaywright step. The navigation that opened this page produced one.",
		waitFor({ target: IDS.MONITOR.PRODUCED }),

		"Each column holds its own settings. The pane shows a column's settings when a person presses the pane's controls toggle. The monitor's settings hold the log's level and whether the log shows substeps. A substep is a step that actuality runs to carry out another step. The log hides substeps by default, so a person reading what the feature did sees the feature's own steps. Showing substeps lists them. Each substep's row links to the step it carries out. The screenshot that actuality takes after each browser step is a substep, so showing substeps shows it.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.CONTROLS_TOGGLE}` }),
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.MONITOR.SUBSTEPS}` }),
		waitFor({ target: IDS.MONITOR.ESTABLISHED_BY }),

		"Turning substeps off shows the feature's own steps again. Each step's products stay on its row.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.MONITOR.SUBSTEPS}` }),
		waitFor({ target: IDS.MONITOR.PRODUCED }),
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.CONTROLS_TOGGLE}` }),

		"The log's scroll rail shows the shared cursor. A person moves the cursor on the rail. The page doesn't have a separate range control. The cursor always marks a moment of actuality, so the rail shows its mark from the start. The mark is at the live edge until a person moves the cursor.",
		waitFor({ target: IDS.SCROLLBAR.RAIL }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		scenario({ scenario: "The log narrows to its rail, and the playback controls move the cursor" }),

		"A minimized monitor shows a narrow form of itself. It hides its rows and keeps its rail. The rail keeps the cursor's mark. The column's strip is the rail, so a click on the strip acts on the rail and doesn't restore the rows. Only the pane's minimize control restores the column.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.MINIMIZE}` }),
		waitFor({ target: IDS.SCROLLBAR.RAIL }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		"The rail doesn't advance the cursor over time. The playback controls move it over time: back to the start, play, back to now and the playback speed. The current-time control on the page strip opens them in a popover outside every pane. The current-time control also opens the log minimized when the log isn't open. The log is already open here, so the control leaves it minimized. The feature presses back to the start, play twice and back to now. These presses check the browser path. The server serves the controls. Each control accepts a press. The page keeps its log throughout. The playback component's unit tests check where the cursor is after each press. Those tests drive the component's frames and don't wait for them.",
		click({ target: IDS.APP.TIME_OFFSET }),
		waitFor({ target: IDS.PLAYBACK.RESTART }),
		waitFor({ target: IDS.PLAYBACK.SPEED }),
		click({ target: IDS.PLAYBACK.RESTART }),
		click({ target: IDS.PLAYBACK.PLAY }),
		click({ target: IDS.PLAYBACK.PLAY }),
		"The back-to-now control returns the cursor to the live edge. The later scenarios then read a page that shows all of actuality, not a moment part-way through it.",
		click({ target: IDS.PLAYBACK.LIVE }),
		"A second press on the current-time control closes the popover, so the popover doesn't cover the controls that later scenarios click.",
		click({ target: IDS.APP.TIME_OFFSET }),

		"The minimize control restores the column. The rows return. The rail is the same element and still shows the cursor's mark.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.MINIMIZE}` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		scenario({ scenario: "Open the graph view and confirm the comments render" }),

		"The graph view draws each individual of a shown type as a node in a scene that a person can rotate. It hides instrumentation types and schema types by default. The comments written above give the view records to draw. The scene on the page shows that the view requested the store's records from the server, read the response and drew the records. The graph view is a separate bundle. The page fetches that bundle from the server, so the scene on the page also shows that the server serves it.",
		"show polymorphic graph view",
		waitFor({ target: IDS.POLYMORPHIC_VIEW.ROOT }),
		waitFor({ target: IDS.POLYMORPHIC_VIEW.SCENE }),

		scenario({ scenario: "Browse the comments in the column browser" }),

		"The column browser lists the stored records of a chosen type. Choosing the Comment type queries the store. The browser shows the comments written earlier in a table with one row for each comment. Every store returns this query's result in one shape, so the browser doesn't hold code for a particular type.",
		...chooseGraphLabel(COMMENT_LABEL),
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),

		scenario({ scenario: "Invoke `show affordances` from Step mode and inspect the goals section" }),

		"The affordances panel renders the goal resolver's verdict for each goal: satisfied, michi, unreachable or refused. The panel doesn't list forward-reachable steps. The actions bar's step picker lists them. The goals list mounts in the panel.",
		...enterStepMode,
		...passesStepExecution("GoalResolutionStepper-showAffordances"),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.AFFORDANCES.GOALS_LIST }),

		scenario({ scenario: "Invoke `show chain lint` and verify the domain chain renders as a graph" }),

		"The chain-lint step returns the lint findings and the graph data. The findings include unsupplied steps, unreachable domains, unproduced domains and string parameters. The graph data holds the forward edges and the goal verdicts. The domain chain view draws the graph data with the graph view. The feature waits for the chain view, its graph slot and the canvas in that slot.",
		...passesStepExecution("GoalResolutionStepper-showDomainChainLint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),
		setAs({ what: CHAIN_GRAPH_CANVAS, domain: "page-locator", value: `"${CHAIN_GRAPH_CANVAS_SELECTOR}"` }),
		waitFor({ target: CHAIN_GRAPH_CANVAS }),

		scenario({ scenario: "Goal resolution: `resolve` returns a verdict for a registered domain" }),

		"The resolver returns a verdict for any registered domain key. The registry holds every locator domain, including page-alt-text. The steps don't produce page-alt-text, so the resolver returns unreachable. The feature stores the goal-resolution product in a variable and checks that the variable exists.",
		setFromStatement({ what: "unproducedGoal", statement: `resolve "page-alt-text"` }),
		exists({ what: "unproducedGoal" }),

		scenario({ scenario: "Repeated `show chain lint` invocations must not duplicate the pane" }),

		"A view-open product is a request to mount a pane. Later steps don't chain from it as a fact. Running the same show step twice reuses the open pane. Each refresh of the affordances stream would add another pane without that reuse. The step dispatcher doesn't auto-assert the product of a view-only domain. This scenario invokes the step a second time and waits for the chain view's root and graph. Each wait reads the first match, so the scenario doesn't count the panes.",
		...passesStepExecution("GoalResolutionStepper-showDomainChainLint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Reload while affordances and domain-chain panes are open: both must restore" }),

		"Reloading the page restores the affordances panel and the chain-lint pane from the URL hash. The step calls above opened both panes. The chain-lint view reads the affordances on offer when it mounts without a product, so it draws the chain after the reload. The feature waits for the root of each pane after the reload.",
		reloadPage({}),
		"The app restores the panes from the URL hash. The reloaded URL still holds the affordances pane in its hash.",
		"save URI to reloadUri",
		'matches reloadUri with "*shu-affordances-panel*"',
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		"The hash restore also restores the monitor and the graph view. The monitor shows its rail with the cursor's mark.",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),
		waitFor({ target: IDS.POLYMORPHIC_VIEW.ROOT }),

		"The show document step opens the document beside the monitor. Both views read actuality the same way. Each reads at the level it shows. Each view spans all of actuality by index and pages a region in as a person scrolls to it. The views don't request a region twice. The document opens at the live edge with its newest events. The top glyph of its rail represents actuality's first row. Pressing the top glyph pages that region in. The feature's own heading then appears on the page.",
		"show document",
		waitFor({ target: IDS.DOCUMENT.ROOT }),
		setAs({ what: FEATURE_HEADING, domain: "page-test-id", value: `"${FEATURE_HEADING}"` }),
		`in "${DOC_CONTAINER}", click ${IDS.SCROLLBAR.POS_TOP}`,
		waitFor({ target: FEATURE_HEADING }),

		"A feature reads every cache value from the client cache view. The view lists each run source read so far with its extent and its cached spans. It lists the live stream by level and what the device's store caches. Each value has its own test id. The document reads actuality at log level, so the view lists the log-level run source. The press on the document's top glyph paged in the start of actuality, so that source's cached spans begin at row 0. Its extent counts the events so far.",
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		setAs({ what: CACHE_LOG_CACHED, domain: "page-test-id", value: `"${CACHE_LOG_CACHED}"` }),
		setAs({ what: CACHE_LOG_EVENTS, domain: "page-test-id", value: `"${CACHE_LOG_EVENTS}"` }),
		waitFor({ target: CACHE_LOG_CACHED }),
		`save text from ${CACHE_LOG_CACHED} to cacheLogCached`,
		'matches cacheLogCached with "0..*"',
		`save text from ${CACHE_LOG_EVENTS} to cacheLogEvents`,
		'not variable cacheLogEvents is "0"',

		"The monitor's rail also spans all of actuality by index, whatever the monitor caches. Its top glyph represents actuality's first row. Pressing the top glyph pages that region in. The first row then appears on the page, although the log cached only its newest page before the press. The page strip's current-time control still opens the playback controls after the reload.",
		`in "${MONITOR_CONTAINER}", click ${IDS.SCROLLBAR.POS_TOP}`,
		waitFor({ target: IDS.MONITOR.FIRST_ROW }),
		click({ target: IDS.APP.TIME_OFFSET }),
		waitFor({ target: IDS.PLAYBACK.PLAY }),
		"A second press closes the popover again.",
		click({ target: IDS.APP.TIME_OFFSET }),

		scenario({ scenario: "Variable inspection: `show vars` should produce an entry per variable set above" }),

		"`show vars` returns the current variables with secret values obscured. The feature stores the step's product in a variable and checks that the variable exists. That check shows that the step returns a product that a variable can hold.",
		setFromStatement({ what: "varsSnapshot", statement: "show vars" }),
		exists({ what: "varsSnapshot" }),

		scenario({ scenario: "Domain inspection: `show domains` lists every registered domain" }),

		"Each stepper can register domains at boot through its concerns. `show domains` returns the registry. The registry holds the domains this feature depends on: Comment, page-test-id and the show view domains. The feature stores the step's product in a variable and checks that the variable exists.",
		setFromStatement({ what: "domainsSnapshot", statement: "show domains" }),
		exists({ what: "domainsSnapshot" }),

		scenario({ scenario: "The domain chain has the graph view's controls" }),

		"The graph view draws the domain chain, so the chain pane holds the graph view's controls. The layout group opens in the chain pane as it does on the main graph. It offers each view type, including the layered top-down and left-right views.",
		inElement({ container: `"${CHAIN_PANE}"`, what: `click ${IDS.POLYMORPHIC_VIEW.SETTINGS.layout}` }),
		inElement({ container: `"${CHAIN_PANE}"`, what: `wait for ${IDS.POLYMORPHIC_VIEW.VIEW_TYPE}` }),

		scenario({ scenario: "The graph view's layout settings open as one group" }),

		"The graph view holds its options in named groups. Each group opens from its own head icon. The layout group holds every control that determines how the graph is placed. Opening it shows the orientation, the view type, the grouping and the depth together. The page doesn't split them across separate toolbars.",
		inElement({ container: `"${MAIN_GRAPH_PANE}"`, what: `click ${IDS.POLYMORPHIC_VIEW.SETTINGS.layout}` }),
		inElement({ container: `"${MAIN_GRAPH_PANE}"`, what: `wait for ${IDS.POLYMORPHIC_VIEW.VIEW_TYPE}` }),

		scenario({ scenario: "Write the standalone HTML report mid-feature" }),

		"`saves shu to` writes a self-contained HTML report. The report holds the SPA bundle and a snapshot of each RPC response and SSE event captured during actuality. Running the step part way through the feature checks that the writer doesn't depend on endFeature.",
		'saves shu to "/tmp/shu.html"',
		"The uncompressed copy holds the same content as plain text. A person can check this copy for secrets without unpacking it.",
		'saves shu uncompressed to "/tmp/shu-audit.html"',

		"The affordances panel has been open since a step showed it. The panel reads the affordances on offer after each step to stay current. Actuality doesn't record a read as an act. Actuality's records name the step that showed the panel and don't name the panel's reads. The report holds actuality's records, so it names showAffordances and doesn't name affordancesOnOffer.",
		'text at "/tmp/shu-audit.html" contains "GoalResolutionStepper.showAffordances"',
		'not text at "/tmp/shu-audit.html" contains "GoalResolutionStepper.affordancesOnOffer"',

		scenario({ scenario: "A reload with the server unreachable reads actuality from the device" }),

		"A page whose calls all fail reports that the site has not responded to it. The page then reads actuality from what this device holds. The device holds every record of actuality that this page has read. It also holds the site's registry. Blocking every remote call and the event stream leaves the page with only the device. A page whose network drops is in the same state. The reload still shows actuality. The registry comes from the device. The log-level run source reads what the device holds and reports that it is disconnected. Its spans start at actuality's first row. The monitor renders rows.",
		`requests matching "${RPC_GLOB}" are "blocked"`,
		`requests matching "${STREAM_GLOB}" are "blocked"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		setAs({ what: CACHE_LOG_LOADED, domain: "page-test-id", value: `"${CACHE_LOG_LOADED}"` }),
		`save text from ${IDS.CLIENT_CACHE.SERVER} to offlineServer`,
		'variable offlineServer is "has not responded to this page"',
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to offlineRegistry`,
		'matches offlineRegistry with "from the device*"',
		setAs({ what: CACHE_LOG_DISCONNECTED, domain: "page-test-id", value: `"${CACHE_LOG_DISCONNECTED}"` }),
		waitFor({ target: CACHE_LOG_DISCONNECTED }),
		`save text from ${CACHE_LOG_CACHED} to offlineCached`,
		'matches offlineCached with "0..*"',
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		scenario({ scenario: "The page reads from the server again when the server responds" }),

		"The page reads the same stores after the network returns. The server is available again. The registry comes from the server again. The log-level run source loads from the server and reports that it is loaded. Every view reads through the one cache, so the views don't change between the two states.",
		`requests matching "${RPC_GLOB}" are "allowed"`,
		`requests matching "${STREAM_GLOB}" are "allowed"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.SERVER} to onlineServer`,
		'matches onlineServer with "last responded at *"',
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to onlineRegistry`,
		'matches onlineRegistry with "from the server*"',
		waitFor({ target: CACHE_LOG_LOADED }),

		scenario({ scenario: "A server that accepts a request without responding is reported unreachable" }),

		"A refused request fails immediately. A read then falls back to the device store. A request that the server accepts without a response is harder to detect. That request doesn't fail, so a read that awaits it doesn't return a result or report an error. Every request the page awaits carries a timeout. A server that doesn't respond within the timeout is reported unreachable. The page then reads its declarations from the device store, as it does when the network drops. This deployment sets a short timeout. A short timeout suits a deployment whose storage responds quickly. The timeout is a deployment option and not a path for tests.",
		`requests matching "${RPC_GLOB}" are "unanswered"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.SERVER} to unansweredServer`,
		'variable unansweredServer is "has not responded to this page"',
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to unansweredRegistry`,
		'matches unansweredRegistry with "from the device*"',

		"The page sends one request for each read. A page with several views open sends many requests at once. The page doesn't send a read within the retry interval of a timed-out read. That read fails at once and reports the server unreachable. The page then falls back without running each read to the timeout. An earlier scenario blocks the requests and checks what the page then reads of actuality.",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"The server responds again, so the page queries it again.",
		`requests matching "${RPC_GLOB}" are "allowed"`,
		reloadPage({}),
		waitFor({ target: CACHE_LOG_LOADED }),

		scenario({ scenario: "A page without a stream reads actuality and doesn't receive events" }),

		"The stream sends events. The page reads actuality from records. A page that reloads with the stream blocked reads the actuality it holds. It doesn't receive an event after that. That state matches a dropped stream connection with the server still reachable. Every other call still works. This page was offline in the scenarios above and holds all of actuality on the device. The reading holds what it read during the reload and doesn't read further. The reading reports this state. A source disconnected from the stream doesn't report itself loaded. The client cache shows it as disconnected.",
		`requests matching "${STREAM_GLOB}" are "blocked"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		waitFor({ target: CACHE_LOG_DISCONNECTED }),
		`save text from ${CACHE_LOG_EVENTS} to eventsUnheard`,

		"Actuality keeps recording while the page doesn't receive its events. The steps below write the records that the reading reads after the stream returns. The feature doesn't check the values these steps set. It depends only on the record each step writes.",
		set({ what: "unheard-1", value: '"recorded while the page was not listening"' }),
		set({ what: "unheard-2", value: '"recorded while the page was not listening"' }),
		set({ what: "unheard-3", value: '"recorded while the page was not listening"' }),
		set({ what: "unheard-4", value: '"recorded while the page was not listening"' }),

		scenario({ scenario: "A view catches up when the stream returns" }),

		"The feature allows the stream. It doesn't reload the page or click it. The page reads again when the stream reconnects. The reading's state is behind from that moment until a read that began after it finishes. Its state is loaded after that read. The page uses one path to follow the stream and to catch up. The feature waits for the loaded state. It doesn't wait for a length of time, because the page reconnects and reads on its own schedule. The reading then holds what actuality recorded while the page didn't read the stream.",
		`requests matching "${STREAM_GLOB}" are "allowed"`,
		waitFor({ target: CACHE_LOG_LOADED }),
		`save text from ${CACHE_LOG_EVENTS} to eventsCaughtUp`,
		"not variable eventsCaughtUp is eventsUnheard",

		scenario({ scenario: "A page without a layout of its own starts on the views actuality showed" }),

		"An address that names views holds a person's own arrangement. Two addresses can therefore show different views of one actuality. An address that doesn't name a view doesn't hold an arrangement. The page then reads actuality's records and shows the views that actuality's steps showed. Actuality doesn't replay events to the page. The page reads actuality's records as it reads everything else. The page's address then names every view that a step of actuality showed, in the order the site declares them. Those views include the monitor, the graph, the document, the client cache and the affordances panel. Only the records state which views those are. An address that names them was built from the records.",
		gotoPage({ name: `"${host}/haibun"` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.DOCUMENT.ROOT }),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		waitFor({ target: CACHE_LOG_CACHED }),
		"save URI to freshUri",
		`matches freshUri with "*col=${SHU_TAG.MONITOR_COLUMN}*"`,
		`matches freshUri with "*col=${SHU_TAG.POLYMORPHIC_GRAPH_VIEW}*"`,
		`matches freshUri with "*col=${SHU_TAG.DOCUMENT_COLUMN}*"`,
		`matches freshUri with "*col=${SHU_TAG.CLIENT_CACHE_COLUMN}*"`,
		`matches freshUri with "*col=${SHU_TAG.AFFORDANCES_PANEL}*"`,

		"The address doesn't name a view that actuality's steps didn't show. This deployment declares the thread column. Actuality's steps didn't open it. An address that named the thread column wouldn't match the records.",
		`not matches freshUri with "*${SHU_TAG.THREAD_COLUMN}*"`,

		scenario({ scenario: "The views on offer are read from what the deployment declares" }),

		"A domain that declares a UI component is a view. The show views step reads the views a person can open from the domain declarations, not from a separate list. The views picker shows one row for each view. Each row's test id names the view that the row opens. This scenario doesn't press a row.",
		"show views",
		setAs({ what: VIEWS_PICKER, domain: "page-test-id", value: `"${VIEWS_PICKER}"` }),
		setAs({ what: VIEWS_PICKER_MONITOR, domain: "page-test-id", value: `"${VIEWS_PICKER_MONITOR}"` }),
		waitFor({ target: VIEWS_PICKER }),
		waitFor({ target: VIEWS_PICKER_MONITOR }),

		"Each row's test id matches one element of this page. The document records what a step showed and doesn't mount the view. The document therefore doesn't hold a second copy of a row. The views picker's unit tests state what pressing a row does.",
	],
};
