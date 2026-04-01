import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import TutorialGraphStepper from "../../build/tutorial-graph-stepper.js";
import ShuStepper from "../../build/shu-stepper.js";
import { SHU_TEST_IDS } from "../../build/test-ids.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";

function flattenTestIds(obj: Record<string, unknown>): string[] {
	const result: string[] = [];
	for (const [, value] of Object.entries(obj)) {
		if (typeof value === "string") result.push(value);
		else if (typeof value === "object" && value !== null) result.push(...flattenTestIds(value as Record<string, unknown>));
	}
	return result;
}

const { getIncomingEdges, exportGraphAsJsonLd } = withAction(new TutorialGraphStepper());
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, click, selectionOption, inputVariable, press, gotoPage, reloadPage } = withAction(new WebPlaywright());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const CV = "createVertex";
const CE = "createEdge";

/** Register step-caller form test IDs for a given step method. */
function stepIds(method: string, params: string[]) {
	return [
		setAs({ what: `${method}-step-run`, domain: "page-test-id", value: `"${method}-step-run"` }),
		...params.map((p) => setAs({ what: `${method}-step-input-${p}`, domain: "page-test-id", value: `"${method}-step-input-${p}"` })),
	];
}

export const features: TKirejiExport = {
	"Hypermedia Tutorial: Rels, Edges, and HATEOAS": [
		feature({ feature: "Hypermedia Fundamentals through shu UI" }),

		...testIdSetup,
		...stepIds(CV, ["label", "id", "data"]),
		...stepIds(CE, ["fromLabel", "fromId", "rel", "toLabel", "toId"]),

		scenario({ scenario: "Start shu with empty graph" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "shu-hypermedia-tutorial"',

		scenario({ scenario: "Create vertices and edges through the Step mode UI" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		selectionOption({ option: '"Step"', field: IDS.APP.MODE_SELECT }),
		"page has settled",

		"Select createVertex and create Dr. Alice Chen.",
		inputVariable({ what: '"create vertex"', field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
		"page has settled",
		waitFor({ target: `${CV}-step-input-label` }),
		inputVariable({ what: '"Researcher"', field: `${CV}-step-input-label` }),
		inputVariable({ what: '"researcher-alice"', field: `${CV}-step-input-id` }),
		inputVariable({ what: JSON.stringify(JSON.stringify({ name: "Dr. Alice Chen", context: "Knowledge Graphs", published: "2020-01-15T00:00:00.000Z" })), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",

		"Create a Paper vertex by changing the form values and re-running.",
		inputVariable({ what: '"Paper"', field: `${CV}-step-input-label` }),
		inputVariable({ what: '"paper-semantic-web"', field: `${CV}-step-input-id` }),
		inputVariable({ what: JSON.stringify(JSON.stringify({ name: "Semantic Graphs with RDF", content: "Explores RDF quads and hypermedia rels for modelling relationships.", published: "2024-03-01T00:00:00.000Z" })), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",

		"Switch to createEdge and link Alice to the paper.",
		inputVariable({ what: '"create edge"', field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
		"page has settled",
		waitFor({ target: `${CE}-step-input-fromLabel` }),
		inputVariable({ what: '"Researcher"', field: `${CE}-step-input-fromLabel` }),
		inputVariable({ what: '"researcher-alice"', field: `${CE}-step-input-fromId` }),
		inputVariable({ what: '"attributedTo"', field: `${CE}-step-input-rel` }),
		inputVariable({ what: '"Paper"', field: `${CE}-step-input-toLabel` }),
		inputVariable({ what: '"paper-semantic-web"', field: `${CE}-step-input-toId` }),
		click({ target: `${CE}-step-run` }),
		"page has settled",

		scenario({ scenario: "Query renders created vertices" }),
		gotoPage({ name: `"${host}/spa?label=Researcher"` }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),

		scenario({ scenario: "Entity column with edges" }),
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),

		scenario({ scenario: "Paper entity via URL" }),
		gotoPage({ name: `"${host}/spa?label=Paper&id=paper-semantic-web"` }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),

		scenario({ scenario: "Incoming edges" }),
		getIncomingEdges({ label: '"Paper"', id: '"paper-semantic-web"', limit: '100', offset: '0' }),

		scenario({ scenario: "JSON-LD export" }),
		exportGraphAsJsonLd({}),

		scenario({ scenario: "Reload preserves state" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		reloadPage({}),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),

		scenario({ scenario: "Type dropdown from concerns" }),
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		waitFor({ target: IDS.APP.TYPE_SELECT }),
		selectionOption({ option: '"Paper"', field: IDS.APP.TYPE_SELECT }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
	],
};
