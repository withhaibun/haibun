import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS } from "@haibun/shu";
import { SHU_TAG } from "@haibun/shu/consts.js";
import { createStepUI, stepTestIds, flattenTestIds } from "@haibun/shu/test/step-ui.js";
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
/** The document column names the rail a press is for: every open virtualized column carries one. */
const DOC_CONTAINER = SHU_TAG.DOCUMENT_COLUMN;
const MONITOR_CONTAINER = SHU_TAG.MONITOR_COLUMN;
/** The block of this feature's own heading in the document, named from the feature's name the way the document names it. */
const FEATURE_HEADING = `${SHU_TEST_IDS.DOCUMENT.HEADING}${headingAnchor("Shu SPA Self-Test")}`;
// The client cache view's readings of the run source at log (the document's level): its cached spans and its extent.
const CACHE_LOG_CACHED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-cached`;
const CACHE_LOG_EVENTS = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-events`;
const CACHE_LOG_LOADED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-loaded`;
/** The same source cut off from the run: it has read, and the stream is down, so it cannot say it is current. */
const CACHE_LOG_DISCONNECTED = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-disconnected`;
/** The line the whole run's shape is read from, the line of the region around where a reader is, and the earliest
 *  division of each that a reader can press. */
const RUN_SHAPE = `${SHU_TEST_IDS.TIME_BAR.ROOT}run`;
const RUN_SHAPE_FIRST_MARK = "run-shape-first-mark";
const FAILURES_FIRST_ROW = "failures-first-row";
const DETAIL_SHAPE_FIRST_MARK = "detail-shape-first-mark";
/** The globs that cover everything this page reads from its server: every remote call and the event stream. */
const RPC_GLOB = "**/rpc/**";
const STREAM_GLOB = "**/sse*";
/** Every open column carries the same controls, so the log's own column names which one a click is for. */
const MONITOR_PANE = `shu-column-pane[column-type="${SHU_TAG.MONITOR_COLUMN}"]`;
/** The list of views the deployment declares, and the row in it that opens the run's own log. */
const VIEWS_PICKER = SHU_TEST_IDS.VIEWS_PICKER.ROOT;
const VIEWS_PICKER_MONITOR = `${SHU_TEST_IDS.VIEWS_PICKER.ROW}${SHU_TAG.MONITOR_COLUMN}`;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
// Step-caller test-ids are generated per-invocation by createStepUI's helpers
// (method + callIndex + param), so there's nothing to pre-register at file scope —
// each invocation does its own setAs via the helper. The empty list is here so the
// `...stepIdSetup` spread below remains a stable extension point.
const stepIdSetup: ReturnType<typeof setAs>[] = [];

const FRAGMENT = "ISECRET";
export const SECRETS = { FRAGMENT, TEST_PASSWORD: `${FRAGMENT}_shu_test` };

export const features: TKirejiExport = {
	"Shu SPA Self-Test": [
		feature({ feature: "Shu SPA Self-Test" }),

		"This feature drives the shu SPA end-to-end as a real user would: open every view, exercise affordances, trigger goal resolution, then reload the page and verify everything reappears. Each scenario narrates why it exists so a reader can follow the system without consulting the implementation.",
		"Every step's screenshot is what the document view builds its manual of the run from, so the run captures one after each.",
		"after every WebPlaywright, take a screenshot",
		...testIdSetup,
		...stepIdSetup,

		scenario({ scenario: "Bootstrap server and seed representative data" }),

		"A live haibun server hosts the SPA and exposes every stepper step as an RPC method. Seeding variables and comments here gives the views something to render — without it, the affordances panel would show only goals and forward steps but no asserted facts.",
		"enable rpc",
		'saves shu to "/tmp/shu.html"',
		serveShuApp({ path: '"/haibun"' }),
		`webserver is listening for "shu-self-test"`,
		"The set/setAs steps and Resources comments will produce facts the affordances panel and graph view rely on.",
		set({ what: "secret-password", value: `"${SECRETS.TEST_PASSWORD}"` }),
		set({ what: "test-subject-1", value: '"Haibun test subject"' }),
		set({ what: "test-subject-2", value: '"Second test subject"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-1"', text: '"First comment at t=0"' }),
		"pause for 1s",
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-1"', text: '"Second comment at t=1s"' }),
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-2"', text: '"Comment on second subject at t=1s"' }),
		"pause for 1s",
		comment({ label: `"${COMMENT_LABEL}"`, id: '"test-subject-2"', text: '"Final comment at t=2s"' }),

		scenario({ scenario: "Open the SPA in a browser and confirm it loads" }),

		"The SPA is a single-page app served at /haibun. Navigating here boots the shu app shell, which connects to /sse for live events and to /rpc for step invocations. If the bundle fails to register web components or the SSE handshake fails, subsequent waitFor calls will time out — which is the signal we want.",
		gotoPage({ name: `"${host}/haibun"` }),

		scenario({ scenario: "Open the monitor column" }),

		"The monitor column subscribes to SSE artifact events and renders them as a log stream. Opening it asserts the SSE handshake reached the client and the event projection runs.",
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		"The log's own scroll rail is where the shared cursor is shown and picked, so there is no separate range control on the page. The moment being shown is always somewhere on the run, so its mark is on the rail from the start: at the live edge, with nothing scrubbed to.",
		waitFor({ target: IDS.SCROLLBAR.RAIL }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		scenario({ scenario: "The log narrows to its rail, and the playback controls move the cursor" }),

		"Minimized, this column is a narrow form of itself: the rows go and the rail stays, with the mark still on it. Its strip is that rail, so a click there is the reader using it rather tha requesting for the rows back, and the control that minimized the column is what opens it again.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.MINIMIZE}` }),
		waitFor({ target: IDS.SCROLLBAR.RAIL }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		"What a rail cannot do is move on its own, and that is what these controls are: back to the start, play, back to now, and a speed. They live in the actions bar at page level, not inside any pane, and the current-time control opens them. It also opens the log when the log is closed; here the reader already has it, so it is left as they have it. Exercising restart then play proves the cursor moves through the run rather than parking at the newest event.",
		click({ target: IDS.APP.TIME_OFFSET }),
		waitFor({ target: IDS.PLAYBACK.RESTART }),
		waitFor({ target: IDS.PLAYBACK.SPEED }),
		click({ target: IDS.PLAYBACK.RESTART }),
		click({ target: IDS.PLAYBACK.PLAY }),
		"pause for 2s",
		click({ target: IDS.PLAYBACK.PLAY }),
		"Back to now, so the later scenarios read a page that is showing everything rather than a moment part-way through the run.",
		click({ target: IDS.PLAYBACK.LIVE }),
		"Close the popover so it does not float over the controls the later scenarios click.",
		click({ target: IDS.APP.TIME_OFFSET }),

		"Opened again, the rows are back and the rail is still the same one.",
		inElement({ container: `"${MONITOR_PANE}"`, what: `click ${IDS.COLUMN_PANE.MINIMIZE}` }),
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),

		scenario({ scenario: "Open the graph view and confirm the seeded comments render" }),

		"The graph view draws whatever types the store caches, placing each individual as a node in a scene the reader can turn. The comments seeded above are the only records here, so the view reaching its scene proves it requested the store over the wire, read the response and drew it. The view arrives as its own bundle, fetched from the running server, so this also proves the server serves it.",
		"show polymorphic graph view",
		waitFor({ target: IDS.POLYMORPHIC_VIEW.ROOT }),
		waitFor({ target: IDS.POLYMORPHIC_VIEW.SCENE }),

		scenario({ scenario: "Browse the seeded comments in the column browser" }),

		"The column browser lists stored records of a chosen type. Picking the Comment type queries the store and shows the comments seeded earlier as a table, one row per comment. Every store responds this query the same way, so the browser needs no type-specific code.",
		...chooseGraphLabel(COMMENT_LABEL),
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),

		scenario({ scenario: "Invoke `show affordances` from Step mode and inspect the goals section" }),

		"The affordances panel renders the goal resolver's per-goal verdicts (satisfied / michi / unreachable / refused). Forward-reachable steps are not duplicated in the panel; they live in the actions-bar's step picker. The goals section must mount with its test-id-wrapped container visible.",
		...enterStepMode,
		...passesStepExecution("GoalResolutionStepper-showAffordances"),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.AFFORDANCES.GOALS_LIST }),

		scenario({ scenario: "Invoke `show chain lint` and verify the domain-chain Mermaid graph renders" }),

		"The chain-lint step returns both the lint findings (orphan steps, starved steps, unreachable domains) and the graph data (forward edges, goal verdicts). The bound view consumes the graph data to render the Mermaid flowchart — opening the pane without a graph would indicate the producer step or the view-open data-threading is broken.",
		...passesStepExecution("GoalResolutionStepper-showDomainChainLint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Goal resolution: `resolve` returns a verdict for a registered domain" }),

		"The resolver reports a verdict for any registered domain key. page-alt-text is registered, as every locator domain is, and no step produces it. The resolver returns unreachable. The test stashes the goal-resolution product into a variable.",
		setFromStatement({ what: "unproducedGoal", statement: `resolve "page-alt-text"` }),
		exists({ what: "unproducedGoal" }),

		scenario({ scenario: "Repeated `show chain lint` invocations must not duplicate the pane" }),

		"Each view-open product is a one-shot signal to mount the pane, not a fact to chain on. Running the same show-X step twice must reuse the existing pane — without that, every refresh of the affordances stream would accumulate new mermaid panes. The dispatcher skips auto-assert for view-only domains; this scenario verifies the no-duplication outcome.",
		...passesStepExecution("GoalResolutionStepper-showDomainChainLint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Reload while affordances and domain-chain panes are open — both must restore" }),

		"After the affordances panel and chain-lint pane have been opened via step invocation, reloading the page must restore them from the URL hash. This is the regression check for the view-open data-threading path: if products aren't preserved through hash-restore, the chain-lint view will mount empty and waitFor on the graph will time out.",
		reloadPage({}),
		"The reloaded URL must still carry the affordances pane in its hash, since that hash is what the app restores the panes from.",
		"save URI to reloadUri",
		"matches reloadUri with *shu-affordances-panel*",
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		"After hash-restore, the monitor and graph-view should also have come back, and with the monitor its rail and the mark on it. The playback controls open from the actions bar's current-time control; click it again after reload to confirm they survive.",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.SCROLLBAR.CURSOR }),
		waitFor({ target: IDS.POLYMORPHIC_VIEW.ROOT }),

		"The document comes back too, with the monitor open beside it. Both read the run the same way, at the level each shows: the whole run by index, paged in as the reader reaches for a region, with nothing requested twice between them. The document opens at the live edge with its newest events, and the start of the run is one press away on its rail: its top glyph is the first row, and pressing it pages that region in, so the feature's own heading is on the page.",
		"show document",
		waitFor({ target: IDS.DOCUMENT.ROOT }),
		setAs({ what: FEATURE_HEADING, domain: "page-test-id", value: `"${FEATURE_HEADING}"` }),
		`in "${DOC_CONTAINER}", click ${IDS.SCROLLBAR.POS_TOP}`,
		waitFor({ target: FEATURE_HEADING }),

		"What the page caches of the run is read from one place: the client cache view lists each run source read so far with its extent and the spans it caches, the live stream by level, and what the device's store caches, every value under its own id. The document reads the run at log, so the source at log is there: the start of the run was just paged in, so its cached spans begin at row 0, and its extent counts the events so far.",
		"show client cache",
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		setAs({ what: CACHE_LOG_CACHED, domain: "page-test-id", value: `"${CACHE_LOG_CACHED}"` }),
		setAs({ what: CACHE_LOG_EVENTS, domain: "page-test-id", value: `"${CACHE_LOG_EVENTS}"` }),
		waitFor({ target: CACHE_LOG_CACHED }),
		`save text from ${CACHE_LOG_CACHED} to cacheLogCached`,
		'matches cacheLogCached with "0..*"',
		`save text from ${CACHE_LOG_EVENTS} to cacheLogEvents`,
		'not variable cacheLogEvents is "0"',

		"The monitor's rail spans the whole run by index too, whatever it caches: its top glyph is the run's first row, and pressing it pages that region in. The first row is then on the page, from a log that cached only its newest page a moment before. The playback controls open from the actions bar's current-time control.",
		`in "${MONITOR_CONTAINER}", click ${IDS.SCROLLBAR.POS_TOP}`,
		waitFor({ target: IDS.MONITOR.FIRST_ROW }),
		click({ target: IDS.APP.TIME_OFFSET }),
		waitFor({ target: IDS.PLAYBACK.PLAY }),
		"Close the popover again so it does not float over later scenarios' controls.",
		click({ target: IDS.APP.TIME_OFFSET }),

		scenario({ scenario: "Variable inspection: `show vars` should produce an entry per seeded variable" }),

		"`show vars` returns the current variable bag with secrets obscured. Stashing from this step lets us assert the output domain shape works end-to-end.",
		setFromStatement({ what: "varsSnapshot", statement: "show vars" }),
		exists({ what: "varsSnapshot" }),

		scenario({ scenario: "Domain inspection: `show domains` lists every registered domain" }),

		"Domain registration is dynamic — every stepper concern can register more domains at boot. Reading the registry confirms domains the test depends on are actually present (Comment, page-test-id, the show* view domains).",
		setFromStatement({ what: "domainsSnapshot", statement: "show domains" }),
		exists({ what: "domainsSnapshot" }),

		scenario({ scenario: "View settings reveals every chain-view control as one group" }),

		"View settings (the gear in the column-pane header) is the single switch for every per-view control: zoom, layout, axis filter. Toggling it on the chain pane reveals the whole controls block at once — this scenario pins the unified-gate invariant so that zoom doesn't drift back into its own toolbar.",
		"in shu-column-pane:has(shu-domain-chain-view), click pane-controls-toggle",
		waitFor({ target: IDS.DOMAIN_CHAIN.CONTROLS }),

		scenario({ scenario: "The graph view's layout settings open as one group" }),

		"The graph view caches its options in named groups, each opened by its own head icon. Opening the layout group delivers up every control that decides how the graph is placed, so a reader reaches the view type, the grouping and the flattening in one move rather than hunting for separate toolbars.",
		click({ target: IDS.POLYMORPHIC_VIEW.SETTINGS.layout }),
		waitFor({ target: IDS.POLYMORPHIC_VIEW.VIEW_TYPE }),

		scenario({ scenario: "Write the standalone HTML report mid-feature" }),

		"`saves shu to` writes a self-contained HTML report — the SPA bundle plus a snapshot of every RPC response and SSE event captured during the run. Running it mid-feature verifies the writer doesn't depend on endFeature timing.",
		'saves shu to "/tmp/shu.html"',
		"An uncompressed copy carries the same content as plain text, so a reader can confirm secrets are redacted in the output without unpacking it.",
		'saves shu uncompressed to "/tmp/shu-audit.html"',

		"The affordances panel has been open since the reader showed it, and it has read the affordances on offer after every step since, to stay current. Reading is not an act of the run: the run's records name the step that showed the panel, and none of the panel's own reading. The report carries the run's records, so it says which.",
		'text at "/tmp/shu-audit.html" contains "GoalResolutionStepper.showAffordances"',
		'not text at "/tmp/shu-audit.html" contains "GoalResolutionStepper.affordancesOnOffer"',

		scenario({ scenario: "A reload with the server unreachable reads the run from the device" }),

		"A page whose calls all fail says the site has not responded to it, and reads the run from what this device holds. Everything this page has read of the run is held there as the records the run wrote, along with the site's registry. Blocking every remote call and the event stream leaves the page with the device alone, which is what a reader has when their network drops. Reloading then must still produce a run: the registry comes from the device, the source at log reads what is held and says so, its spans starting at the run's first row, and the monitor renders rows.",
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

		scenario({ scenario: "The server responding again returns the page to it" }),

		"A network that comes back is the same page reading the same stores, with the server available again: the registry is the server's once more, and the run source is loaded from it. Nothing about the views changes between the two states, which is the point of reading everything through the one cache.",
		`requests matching "${RPC_GLOB}" are "allowed"`,
		`requests matching "${STREAM_GLOB}" are "allowed"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.SERVER} to onlineServer`,
		'matches onlineServer with "last responded at *"',
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to onlineRegistry`,
		'matches onlineRegistry with "from the server*"',
		waitFor({ target: CACHE_LOG_LOADED }),

		scenario({ scenario: "A page with no stream reads the run and hears nothing" }),

		"The stream announces; the run is read from records. A page that reloads with the stream blocked reads the run it holds and is told nothing after that, which is a reader whose connection dropped rather than one whose server is gone: every other call still works. This page has been without its server altogether and holds the whole run on the device, which is the page that once stopped catching up. What the reading holds is what it read on the way in, and it stops there. The reading says so itself: a source cut off from the stream cannot claim to be current, and the client cache shows it as cut off rather than as read.",
		`requests matching "${STREAM_GLOB}" are "blocked"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		waitFor({ target: CACHE_LOG_DISCONNECTED }),
		`save text from ${CACHE_LOG_EVENTS} to eventsUnheard`,

		"The run goes on recording while the page hears none of it: these steps are the records the reading has to catch up on.",
		"pause for 1s",
		"pause for 1s",
		"pause for 1s",
		"pause for 1s",

		scenario({ scenario: "The stream coming back is what a view catches up on" }),

		"Allowing the stream is the only thing that happens: the page is not reloaded and nothing is clicked. The stream coming back is itself the announcement that there is something to read again for, so the reading is behind from that moment until a read begun after it has finished, and current after that. Catching up is not a second path beside following: it is the same one. A feature waits for the reading to say it is current rather than for a length of time, since a page reconnects on its own schedule and reads on its own, and what it then holds is what the run recorded while nobody was listening.",
		`requests matching "${STREAM_GLOB}" are "allowed"`,
		waitFor({ target: CACHE_LOG_LOADED }),
		`save text from ${CACHE_LOG_EVENTS} to eventsCaughtUp`,
		"not variable eventsCaughtUp is eventsUnheard",

		scenario({ scenario: "The shape of the run is read from counts, and a division of it is where a reader can go" }),

		"The bar across the page shows the run's shape: the run divides into a fixed number of divisions and each one that holds something is marked, so a run of any length draws the same way and reading it costs what the divisions cost rather than what the run does. The store counts; no records are read to draw it. This run has failed a step, so a division of it is marked as a failure, and pressing that division scrubs every view to where it begins.",
		setAs({ what: RUN_SHAPE, domain: "page-test-id", value: `"${RUN_SHAPE}"` }),
		setAs({ what: RUN_SHAPE_FIRST_MARK, domain: "page-locator", value: `"[data-testid^='${SHU_TEST_IDS.TIME_BAR.MARK}run-'] >> nth=0"` }),
		setAs({ what: DETAIL_SHAPE_FIRST_MARK, domain: "page-locator", value: `"[data-testid^='${SHU_TEST_IDS.TIME_BAR.MARK}detail-'] >> nth=0"` }),
		setAs({ what: IDS.CLIENT_CACHE.CURSOR, domain: "page-test-id", value: `"${IDS.CLIENT_CACHE.CURSOR}"` }),
		setAs({ what: IDS.CLIENT_CACHE.READING_AT, domain: "page-test-id", value: `"${IDS.CLIENT_CACHE.READING_AT}"` }),
		waitFor({ target: RUN_SHAPE }),

		"Every view follows the shared cursor, and the client cache says where it is: at the live edge until a reader moves it. Pressing the earliest division of the run moves it there, which is a moment the run has already passed.",
		`save text from ${IDS.CLIENT_CACHE.CURSOR} to cursorAtEdge`,
		'variable cursorAtEdge is "live edge"',
		`save text from ${IDS.CLIENT_CACHE.READING_AT} to readingAtEdge`,
		'variable readingAtEdge is "following the newest records"',
		click({ target: RUN_SHAPE_FIRST_MARK }),
		`save text from ${IDS.CLIENT_CACHE.CURSOR} to cursorAfterPress`,
		'not variable cursorAfterPress is "live edge"',

		"A reader who has moved is shown the region around where they are as its own line, at its own scale. The whole run's line divides a run of any length into the same number of divisions, so a division of a long run covers a stretch a reader cannot read anything from; the region is counted in records rather than measured in time, so it holds the same number of records wherever in the run a reader stands. On a run shorter than the region the two lines cover the same span, which is what the region around a reader is when the whole run is around them. Pressing a division of the region moves the cursor within it, and the reader is still reading the past.",
		click({ target: DETAIL_SHAPE_FIRST_MARK }),
		`save text from ${IDS.CLIENT_CACHE.CURSOR} to cursorInRegion`,
		'not variable cursorInRegion is "live edge"',

		"Moving the cursor is not enough on its own. A window holds a few thousand records, so a division far from the newest records is a division no window holds, and a reader pressing it would be shown the records they had left. The cursor names the moment the run is read around, so pressing a division reads the run there. The client cache says which it is: the newest records are followed until a reader moves, and after that the run is read around the moment they moved to.",
		`save text from ${IDS.CLIENT_CACHE.READING_AT} to readingAfterPress`,
		`matches readingAfterPress with "the run is read around *"`,

		scenario({ scenario: "What the run failed at is listed beside the line that marks where it falls" }),

		"A mark says which division of the run holds a failure, which is where to look; the list beside it says which failures those are. It is the ordinary windowed query with a filter, capped, so a run of any length costs one read to list. A row names what failed and why, and pressing it moves the shared cursor to that moment, so every open view scrubs to the failure a reader chose.",
		setAs({ what: FAILURES_FIRST_ROW, domain: "page-locator", value: `"[data-testid^='${SHU_TEST_IDS.FAILURES.ROW}'] >> nth=0"` }),
		setAs({ what: IDS.FAILURES.ROOT, domain: "page-test-id", value: `"${IDS.FAILURES.ROOT}"` }),
		setAs({ what: IDS.FAILURES.COUNT, domain: "page-test-id", value: `"${IDS.FAILURES.COUNT}"` }),
		waitFor({ target: IDS.FAILURES.ROOT }),
		`save text from ${IDS.FAILURES.COUNT} to failedCount`,
		'matches failedCount with "* failed"',
		click({ target: FAILURES_FIRST_ROW }),
		`save text from ${IDS.CLIENT_CACHE.CURSOR} to cursorAtFailure`,
		'not variable cursorAtFailure is "live edge"',

		scenario({ scenario: "A page with no layout of its own starts on the views the run showed" }),

		"An address that names views is a reader's own arrangement, which is what lets two addresses show different views of one run. An address that names none is a reader with no arrangement, and they are shown the views this run has shown, read from its records. Nothing is replayed to the page: it reads the run, as it reads everything else. The address it arrives at then names every view a step of this run showed, the monitor, the graph, the document, the client cache and the affordances panel among them, in the order the site declares them. Which views those are is stated nowhere but the records, so an address naming them was built from the records.",
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

		"A view no step of this run showed is not among them. The thread column is one this deployment declares and this run never opened, so an address that named it would be naming something other than what the records say.",
		`not matches freshUri with "*${SHU_TAG.THREAD_COLUMN}*"`,


		scenario({ scenario: "The views on offer are read from what the deployment declares" }),

		"A type that names a component to show itself is a view, so what a reader can open is read from the declarations rather than from a list kept beside them. Asking for the views shows that list, with a row for each, named by the view that row opens. A press is not stated here: the document embeds every view a step of this run showed, so a second copy of this list stands in the manual it builds, and the row's name identifies two elements rather than one.",
		"show views",
		setAs({ what: VIEWS_PICKER, domain: "page-test-id", value: `"${VIEWS_PICKER}"` }),
		setAs({ what: VIEWS_PICKER_MONITOR, domain: "page-test-id", value: `"${VIEWS_PICKER_MONITOR}"` }),
		waitFor({ target: VIEWS_PICKER }),
		waitFor({ target: VIEWS_PICKER_MONITOR }),

		"Each row names one element of this page. The manual the document builds records what a step showed rather than mounting the view again, so the name a row carries belongs to that row alone. What pressing a row does is a rule of the picker, stated where the picker is.",
	],
};
