import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import TutorialGraphStepper from "@haibun/shu/tutorial-graph-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, createStepUI, stepTestIds, flattenTestIds } from "@haibun/shu";

const wp = new WebPlaywright();
const { getIncomingEdges, exportGraphAsJsonLd } = withAction(new TutorialGraphStepper());
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, click, gotoPage, reloadPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution, selectGraphLabel } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

export const features: TKirejiExport = {
	"Hypermedia Tutorial: Rels, Edges, and HATEOAS": [
		feature({ feature: "Hypermedia Fundamentals through shu UI" }),

		...testIdSetup,

		scenario({ scenario: "Start shu with empty graph" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "shu-hypermedia-tutorial"',

		scenario({ scenario: "Enter recipe data through the Step mode UI" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",

		...enterStepMode,
		"Create the Classic Cheesecake recipe.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Recipe"',
			id: '"classic-cheesecake"',
			data: json({
				name: "Classic Cheesecake",
				description: "A dense, smooth baked cheesecake on a graham crust. The reference all other cheesecakes vary from.",
				published: "2021-05-01T00:00:00.000Z",
			}),
		}),

		"Create the Lemon Cheesecake recipe — a variation.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Recipe"',
			id: '"lemon-cheesecake"',
			data: json({
				name: "Lemon Cheesecake",
				description: "The classic, brightened with lemon zest and juice folded into the batter.",
				published: "2022-03-14T00:00:00.000Z",
			}),
		}),

		"Create the Cream Cheese ingredient.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Ingredient"',
			id: '"cream-cheese"',
			data: json({ name: "Cream Cheese", published: "2021-05-01T00:00:00.000Z" }),
		}),

		"Create the Lemon Zest ingredient.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Ingredient"',
			id: '"lemon-zest"',
			data: json({ name: "Lemon Zest", published: "2022-03-14T00:00:00.000Z" }),
		}),

		"Link the variation to the recipe it is based on.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Recipe"',
			fromId: '"lemon-cheesecake"',
			rel: '"inReplyTo"',
			toLabel: '"Recipe"',
			toId: '"classic-cheesecake"',
		}),

		"Link ingredients to the recipes that use them.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Ingredient"',
			fromId: '"cream-cheese"',
			rel: '"isPartOf"',
			toLabel: '"Recipe"',
			toId: '"classic-cheesecake"',
		}),
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Ingredient"',
			fromId: '"cream-cheese"',
			rel: '"isPartOf"',
			toLabel: '"Recipe"',
			toId: '"lemon-cheesecake"',
		}),
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Ingredient"',
			fromId: '"lemon-zest"',
			rel: '"isPartOf"',
			toLabel: '"Recipe"',
			toId: '"lemon-cheesecake"',
		}),

		scenario({ scenario: "Query renders Recipe vertices" }),
		gotoPage({ name: `"${host}/spa?label=Recipe"` }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),

		scenario({ scenario: "Entity column shows recipe details and the links to and from it" }),
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),

		scenario({ scenario: "The variation recipe via direct URL, following its variationOf link" }),
		gotoPage({ name: `"${host}/spa?label=Recipe&id=lemon-cheesecake"` }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),

		scenario({ scenario: "Incoming edge discovery: what links to the classic recipe" }),
		getIncomingEdges({
			label: '"Recipe"',
			id: '"classic-cheesecake"',
			limit: "100",
			offset: "0",
		}),

		scenario({ scenario: "JSON-LD export" }),
		exportGraphAsJsonLd({}),

		scenario({ scenario: "Reload preserves navigation state" }),
		gotoPage({ name: `"${host}/spa?label=Recipe"` }),
		"page has settled",
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		reloadPage({}),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),

		scenario({ scenario: "Type dropdown switches between vertex types" }),
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		...selectGraphLabel("Ingredient"),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),
	],
};
