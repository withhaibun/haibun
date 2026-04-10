import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, flattenTestIds } from "@haibun/shu";

const wp = new WebPlaywright();
const { waitFor, click, selectionOption, gotoPage, reloadPage } = withAction(wp);
const { serveShuApp } = withAction(new ShuStepper());
const vs = new VariablesStepper();
const { set, setAs, annotate } = withAction(vs);
const { feature } = withAction(new Haibun());

const host = "http://localhost:8239";
const IDS = SHU_TEST_IDS;
const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const FRAGMENT = "ISECRET";
export const SECRETS = { FRAGMENT, TEST_PASSWORD: `${FRAGMENT}_shu_test` };

export const features: TKirejiExport = {
	"Shu SPA Self-Test": [
		feature({ feature: "Shu SPA Self-Test" }),
		"after every WebPlaywright, take a screenshot",
		...testIdSetup,

		// ── Server + data ───────────────────────────────────────────────
		"Start server with RPC and monitor.",
		"enable rpc",
		'saves shu to "/tmp/shu.html"',
		serveShuApp({ path: '"/haibun"' }),
		`webserver is listening for "shu-self-test"`,

		"Create representative data: variables and annotations spread over 2 seconds.",
		set({ what: "secret-password", value: `"${SECRETS.TEST_PASSWORD}"` }),
		set({ what: "test-subject-1", value: '"Haibun test subject"' }),
		set({ what: "test-subject-2", value: '"Second test subject"' }),
		annotate({ label: '"Annotation"', id: '"test-subject-1"', text: '"First annotation at t=0"' }),
		"pause for 1s",
		annotate({ label: '"Annotation"', id: '"test-subject-1"', text: '"Second annotation at t=1s"' }),
		annotate({ label: '"Annotation"', id: '"test-subject-2"', text: '"Annotation on second subject at t=1s"' }),
		"pause for 1s",
		annotate({ label: '"Annotation"', id: '"test-subject-2"', text: '"Final annotation at t=2s"' }),

		// ── SPA ─────────────────────────────────────────────────────────
		"Open the SPA and verify it loads.",
		gotoPage({ name: `"${host}/haibun"` }),
		"page has settled",

		// ── Monitor + timeline ──────────────────────────────────────────
		"Open the monitor column and verify timeline controls.",
		"show monitor",
		"page has settled",
		waitFor({ target: IDS.MONITOR.LOG_STREAM }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		waitFor({ target: IDS.TIMELINE.SLIDER }),
		waitFor({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.RESTART }),
		waitFor({ target: IDS.TIMELINE.SPEED }),

		"Click restart to set cursor to beginning.",
		click({ target: IDS.TIMELINE.RESTART }),
		"page has settled",
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),

		"Play for 2 seconds, then pause.",
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		"pause for 2s",
		click({ target: IDS.TIMELINE.PLAY_PAUSE }),
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),

		// ── Sequence diagram ────────────────────────────────────────────
		"Open the sequence diagram.",
		"show sequence diagram",
		"page has settled",
		waitFor({ target: IDS.MONITOR.SEQUENCE_DIAGRAM }),

		// ── Graph view ──────────────────────────────────────────────────
		"Open the graph view — annotations should render.",
		"show graph view",
		"page has settled",
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),

		// ── Column browser ──────────────────────────────────────────────
		"Browse annotation data so RPC cache captures query results for offline export.",
		waitFor({ target: IDS.APP.TWISTY }),
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		waitFor({ target: IDS.APP.TYPE_SELECT }),
		selectionOption({ option: '"Annotation"', field: IDS.APP.TYPE_SELECT }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),

		// ── Reload ──────────────────────────────────────────────────────
		"Reload the page — graph and timeline should persist.",
		reloadPage({}),
		"page has settled",
		"show monitor",
		"show graph view",
		"page has settled",
		waitFor({ target: IDS.TIMELINE.TIME_DISPLAY }),
		waitFor({ target: IDS.GRAPH_VIEW.ROOT }),
	],
};
