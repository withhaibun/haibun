import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import ResourcesStepper from "@haibun/core/steps/resources-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, flattenTestIds } from "@haibun/shu";
import { createStepUI, stepTestIds } from "@haibun/shu/test/step-ui.js";
import { COMMENT_LABEL } from "@haibun/core/lib/resources.js";

const wp = new WebPlaywright();
const { waitFor, click, selectionOption, gotoPage, reloadPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const { set, setAs, exists, setFromStatement } = withAction(new VariablesStepper());
const { comment } = withAction(new ResourcesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);

const host = "http://localhost:8239";
const IDS = SHU_TEST_IDS;
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

		scenario({ scenario: "Actions-bar timeline mounts and the scrubber moves" }),

		"The timeline scrubber lives in the actions-bar at the page level (not inside any pane) — it consumes the same SSE event stream as the monitor and drives time-travel for every view via TIME_SYNC. The actions-bar's filter row (where the scrubber sits) collapses until the twisty is clicked; expand it first, then assert the timeline is interactive. Exercising play/restart proves the cursor moves through history rather than parking at the latest event.",
		waitFor({ target: IDS.APP.TWISTY }),
		click({ target: IDS.APP.TWISTY }),
		waitFor({ target: IDS.TIMELINE.SLIDER }),
		waitFor({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.RESTART }),
		waitFor({ target: IDS.TIMELINE.SPEED }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		click({ target: IDS.TIMELINE.RESTART }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		"pause for 2s",
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),

		scenario({ scenario: "Open the monitor column" }),

		"The monitor column subscribes to SSE artifact events and renders them as a log stream. Opening it asserts the SSE handshake reached the client and the event projection runs.",
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),

		scenario({ scenario: "Open the sequence diagram" }),

		"The sequence-diagram view renders Mermaid from the same event stream the monitor subscribes to. Different projection of the same data — useful for spotting RPC chains.",
		"show sequence diagram",
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),

		scenario({ scenario: "Open the graph view (mermaid) and confirm comments render" }),

		"The graph view renders the quad store as a Mermaid flowchart, with each named-graph as a subgraph. Our seeded comments live in the Comment named-graph; the graph view should pick them up via RPC and render the comment nodes.",
		"show graph view",
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),

		scenario({ scenario: "Invoke `show affordances` from Step mode and inspect the goals section" }),

		"The affordances panel renders the goal resolver's per-goal verdicts (satisfied / michi / unreachable / refused). Forward-reachable steps are not duplicated in the panel; they live in the actions-bar's step picker. The goals section must mount with its test-id-wrapped container visible.",
		...enterStepMode,
		...passesStepExecution("show affordances"),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.AFFORDANCES.GOALS_LIST }),

		scenario({ scenario: "Invoke `show chain lint` and verify the domain-chain Mermaid graph renders" }),

		"The chain-lint step returns both the lint findings (orphan steps, starved steps, unreachable domains) and the graph data (forward edges, goal verdicts). The bound view consumes the graph data to render the Mermaid flowchart — opening the pane without a graph would indicate the producer step or the view-open data-threading is broken.",
		...passesStepExecution("show chain lint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Goal resolution: `resolve` returns a verdict for a registered domain" }),

		"The resolver reports a verdict for any registered domain key. test-scratch is registered but has no producer step. The resolver returns unreachable. The test stashes the goal-resolution product into a variable.",
		setFromStatement({ what: "scratchGoal", statement: `resolve "test-scratch"` }),
		exists({ what: "scratchGoal" }),

		scenario({ scenario: "Repeated `show chain lint` invocations must not duplicate the pane" }),

		"Each view-open product is a one-shot signal to mount the pane, not a fact to chain on. Running the same show-X step twice must reuse the existing pane — without that, every refresh of the affordances stream would accumulate new mermaid panes. The dispatcher skips auto-assert for view-only domains; this scenario verifies the no-duplication outcome.",
		...passesStepExecution("show chain lint"),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.GRAPH }),

		scenario({ scenario: "Reload while affordances and domain-chain panes are open — both must restore" }),

		"After the affordances panel and chain-lint pane have been opened via step invocation, reloading the page must restore them from the URL hash. This is the regression check for the view-open data-threading path: if products aren't preserved through hash-restore, the chain-lint view will mount empty and waitFor on the graph will time out.",
		reloadPage({}),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.DOMAIN_CHAIN.ROOT }),
		"After hash-restore, monitor / sequence-diagram / graph-view should also have come back. Timeline lives in the actions-bar's collapsible filter row; expand it again after reload to confirm the scrubber survives.",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),
		click({ target: IDS.APP.TWISTY }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),

		scenario({ scenario: "Variable inspection: `show vars` should produce an entry per seeded variable" }),

		"`show vars` returns the current variable bag with secrets obscured. Stashing from this step lets us assert the output domain shape works end-to-end.",
		setFromStatement({ what: "varsSnapshot", statement: "show vars" }),
		exists({ what: "varsSnapshot" }),

		scenario({ scenario: "Domain inspection: `show domains` lists every registered domain" }),

		"Domain registration is dynamic — every stepper concern can register more domains at boot. Reading the registry confirms domains the test depends on are actually present (Comment, page-test-id, the show* view domains).",
		setFromStatement({ what: "domainsSnapshot", statement: "show domains" }),
		exists({ what: "domainsSnapshot" }),

		scenario({ scenario: "Browse the comment data via the column browser" }),

		"The column browser lets users navigate the quad store by type and entity. Selecting the Comment type populates the query table, exercising the type-select dropdown, the query-results RPC path, and the result-table component. This scenario is intentionally last because the col-browser's query-table sometimes races against the RPC cache and a failure here shouldn't mask earlier regressions.",
		waitFor({ target: IDS.APP.TWISTY }),
		click({ target: IDS.APP.TWISTY }),
		waitFor({ target: IDS.APP.TYPE_SELECT }),
		selectionOption({ option: `"${COMMENT_LABEL}"`, field: IDS.APP.TYPE_SELECT }),
		waitFor({ target: IDS.QUERY.TABLE }),

		scenario({ scenario: "View settings reveals every chain-view control as one group" }),

		"View settings (the gear in the column-pane header) is the single switch for every per-view control: zoom, layout, axis filter. Toggling it on the chain pane reveals the whole controls block at once — this scenario pins the unified-gate invariant so that zoom doesn't drift back into its own toolbar.",
		"in shu-column-pane:has(shu-domain-chain-view), click pane-controls-toggle",
		waitFor({ target: IDS.DOMAIN_CHAIN.CONTROLS }),

		scenario({ scenario: "View settings reveals every graph-view control as one group" }),

		"Same invariant for the graph view: toolbar (zoom + layout + copy) and the predicate / axis filters all toggle together off a single gear click.",
		"in shu-column-pane:has(shu-graph-view), click pane-controls-toggle",
		waitFor({ target: IDS.GRAPH_VIEW.CONTROLS }),

		scenario({ scenario: "Write the standalone HTML report mid-feature" }),

		"`saves shu to` writes a self-contained HTML report — the SPA bundle plus a snapshot of every RPC response and SSE event captured during the run. Running it mid-feature verifies the writer doesn't depend on endFeature timing.",
		'saves shu to "/tmp/shu.html"',
	],
};
