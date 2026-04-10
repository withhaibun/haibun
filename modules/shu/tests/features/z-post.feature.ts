import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import TutorialGraphStepper from "@haibun/shu/tutorial-graph-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, flattenTestIds } from "@haibun/shu";

const wp = new WebPlaywright();
const { createVertex, createEdge } = withAction(new TutorialGraphStepper());
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, gotoPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

export const features: TKirejiExport = {
	"Standalone HTML export": [
		feature({ feature: "Standalone HTML export" }),

		"Verifies that a standalone shu.html file is written at endFeature with embedded graph data.",

		...testIdSetup,

		scenario({ scenario: "Create graph data and verify SPA renders" }),

		"enable rpc",
		serveShuApp({ path: '"/shu"' }),
		`webserver is listening for "z-post-test"`,

		createVertex({ label: '"Person"', data: json({ id: "alice", name: "Alice", addedDate: new Date().toISOString() }) }),
		createVertex({ label: '"Person"', data: json({ id: "bob", name: "Bob", addedDate: new Date().toISOString() }) }),
		createEdge({ fromLabel: '"Person"', fromId: '"alice"', rel: '"knows"', toLabel: '"Person"', toId: '"bob"' }),

		gotoPage({ name: `"${host}/shu"` }),
		"show graph view",
		waitFor({ target: IDS.APP.MAIN }),

		"The standalone shu.html with embedded data is written automatically at endFeature by MonitorStepper.",
	],
};
