import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, stepTestIds, flattenTestIds } from "../../build/index.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { gotoPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));
const stepIdSetup = stepTestIds(["label", "id", "data", "text", "fromLabel", "fromId", "rel", "toLabel", "toId"]).map((id) =>
	setAs({ what: id, domain: "page-test-id", value: `"${id}"` }),
);

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

export const features: TKirejiExport = {
	"Thread view with comments and replies": [
		feature({ feature: "Comments and getRelated for conversation threading" }),

		...testIdSetup,
		...stepIdSetup,

		scenario({ scenario: "Set up graph with threaded conversation" }),
		"The tutorial graph stepper provides an in-memory graph store.",
		"Two researchers are created, then a paper. One researcher replies to the other via an edge.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "thread-test"',

		scenario({ scenario: "Create vertices with inReplyTo chain" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		...enterStepMode,

		"Create root vertex.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Researcher"',
			id: '"alice"',
			data: json({ name: "Alice Chen", context: "Linked Data", published: "2026-01-01T00:00:00.000Z" }),
		}),

		"Create a reply vertex.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Researcher"',
			id: '"bob"',
			data: json({ name: "Bob Smith", context: "Semantic Web", published: "2026-01-02T00:00:00.000Z" }),
		}),

		"Link Bob as a reply to Alice.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Researcher"',
			fromId: '"bob"',
			rel: '"inReplyTo"',
			toLabel: '"Researcher"',
			toId: '"alice"',
		}),

		scenario({ scenario: "Comment on a vertex" }),
		"Create a comment on Alice. The comment becomes part of the conversation.",
		...passesStepExecution("ResourcesStepper-comment", { label: '"Researcher"', id: '"alice"', text: '"This researcher is interesting"' }),

		scenario({ scenario: "Get related items" }),
		"The getRelated step returns all items in the conversation: the root, the reply, and the comment.",
		...passesStepExecution("ResourcesStepper-getRelated", { label: '"Researcher"', id: '"alice"' }),
	],
};
