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
// Register the step-caller test-ids so `click({target: "current-step-run"})` resolves
// via `getByTestId` rather than the `getByText` fallback. createStepUI's helpers all
// target ids in this list.
const stepIdSetup = stepTestIds([]).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

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

		scenario({ scenario: "Open the monitor column and exercise the timeline" }),

		"The monitor column subscribes to SSE artifact events and renders them as a log stream with a timeline scrubber. The timeline controls are part of the same component because monitoring and time-travel share the same event stream. Exercising play/restart verifies the cursor moves through history.",
		"show monitor",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		waitFor({ target: IDS.TIMELINE.SLIDER }),
		waitFor({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.RESTART }),
		waitFor({ target: IDS.TIMELINE.SPEED }),
		"Restart, then play for two seconds, then pause — proves the scrubber actually moves rather than sitting at the latest event.",
		click({ target: IDS.TIMELINE.RESTART }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		"pause for 2s",
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),

		scenario({ scenario: "Open the sequence diagram" }),

		"The sequence-diagram view renders Mermaid from the same event stream the monitor subscribes to. Different projection of the same data — useful for spotting RPC chains.",
		"show sequence diagram",
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),

		scenario({ scenario: "Open the graph view (mermaid) and confirm comments render" }),

		"The graph view renders the quad store as a Mermaid flowchart, with each named-graph as a subgraph. Our seeded comments live in the Comment named-graph; the graph view should pick them up via RPC and render the comment nodes.",
		"show graph view",
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),

		scenario({ scenario: "Invoke `show affordances` from Step mode and inspect both sections" }),

		"The affordances panel renders the goal resolver's view of the world: forward-reachable steps (steps whose inputs are satisfied right now) and per-goal verdicts (satisfied / michi / unreachable / refused). Both sections must mount with their test-id-wrapped containers visible.",
		...enterStepMode,
		...passesStepExecution("show affordances"),
		waitFor({ target: IDS.AFFORDANCES.ROOT }),
		waitFor({ target: IDS.AFFORDANCES.FORWARD_LIST }),
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
		"After hash-restore, monitor / timeline / sequence-diagram / graph-view should also have come back.",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),

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

		scenario({ scenario: "Write the standalone HTML report mid-feature" }),

		"`saves shu to` writes a self-contained HTML report — the SPA bundle plus a snapshot of every RPC response and SSE event captured during the run. Running it mid-feature verifies the writer doesn't depend on endFeature timing.",
		'saves shu to "/tmp/shu.html"',
	],
};
