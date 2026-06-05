import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import ShuStepper from "../../build/shu-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import { createStepUI, flattenTestIds } from "../../build/index.js";

const wp = new WebPlaywright();
const { serveShuApp } = withAction(new ShuStepper());
const { gotoPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

export const features: TKirejiExport = {
	"Thread view with comments and replies": [
		feature({ feature: "Comments and getRelated for conversation threading" }),

		...testIdSetup,

		scenario({ scenario: "Set up a recipe and a variation of it" }),
		"A recipe and a variation of it form a small tree; a comment on the recipe joins the conversation.",
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "thread-test"',

		scenario({ scenario: "Create a recipe and a variation linked by variationOf" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		...enterStepMode,

		"Create the root recipe.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Recipe"',
			id: '"classic-cheesecake"',
			data: json({ name: "Classic Cheesecake", description: "The reference cheesecake.", published: "2021-05-01T00:00:00.000Z" }),
		}),

		"Create a variation.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Recipe"',
			id: '"lemon-cheesecake"',
			data: json({ name: "Lemon Cheesecake", description: "The classic, brightened with lemon.", published: "2022-03-14T00:00:00.000Z" }),
		}),

		"Link the variation to the recipe it is based on.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Recipe"',
			fromId: '"lemon-cheesecake"',
			rel: '"inReplyTo"',
			toLabel: '"Recipe"',
			toId: '"classic-cheesecake"',
		}),

		scenario({ scenario: "Comment on the recipe" }),
		"Create a comment on the classic recipe. The comment becomes part of the conversation.",
		...passesStepExecution("ResourcesStepper-comment", { label: '"Recipe"', id: '"classic-cheesecake"', text: '"Best with a graham crust."' }),

		scenario({ scenario: "Get related items" }),
		"The getRelated step returns everything in the conversation: the recipe, its variation, and the comment.",
		...passesStepExecution("ResourcesStepper-getRelated", { label: '"Recipe"', id: '"classic-cheesecake"' }),
	],
};
