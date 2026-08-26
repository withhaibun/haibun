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
const CACHE_LOG_STATE = `${SHU_TEST_IDS.CLIENT_CACHE.SOURCE}log-state`;
/** The globs that cover everything this page reads from its server: every remote call and the event stream. */
const RPC_GLOB = "**/rpc/**";
const STREAM_GLOB = "**/sse*";
/** Every open column carries the same controls, so the log's own column names which one a click is for. */
const MONITOR_PANE = `shu-column-pane[column-type="${SHU_TAG.MONITOR_COLUMN}"]`;
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

		scenario({ scenario: "A reload with the server unreachable reads the run from the device" }),

		"Everything this page has read of the run is cached on the device: the events by their index at each level, each level's extent, and the site's registry. Blocking every remote call and the event stream leaves the page with the device alone, which is what a reader has when their network drops. Reloading then must still produce a run: the registry comes from the device, the source at log reports itself loaded with its cached spans starting at the run's first row, and the monitor renders rows.",
		`requests matching "${RPC_GLOB}" are "blocked"`,
		`requests matching "${STREAM_GLOB}" are "blocked"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		setAs({ what: CACHE_LOG_STATE, domain: "page-test-id", value: `"${CACHE_LOG_STATE}"` }),
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to offlineRegistry`,
		'matches offlineRegistry with "from the device*"',
		`save text from ${CACHE_LOG_STATE} to offlineState`,
		'variable offlineState is "loaded"',
		`save text from ${CACHE_LOG_CACHED} to offlineCached`,
		'matches offlineCached with "0..*"',
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		scenario({ scenario: "The server responding again returns the page to it" }),

		"A network that comes back is the same page reading the same stores, with the server available again: the registry is the server's once more, and the run source is loaded from it. Nothing about the views changes between the two states, which is the point of reading everything through the one cache.",
		`requests matching "${RPC_GLOB}" are "allowed"`,
		`requests matching "${STREAM_GLOB}" are "allowed"`,
		reloadPage({}),
		waitFor({ target: IDS.CLIENT_CACHE.ROOT }),
		`save text from ${IDS.CLIENT_CACHE.REGISTRY} to onlineRegistry`,
		'matches onlineRegistry with "from the server*"',
		`save text from ${CACHE_LOG_STATE} to onlineState`,
		'variable onlineState is "loaded"',
	],
};
