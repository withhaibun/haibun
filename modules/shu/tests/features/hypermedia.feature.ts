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

function stepIds(method: string, params: string[]) {
	return [
		setAs({ what: `${method}-step-run`, domain: "page-test-id", value: `"${method}-step-run"` }),
		setAs({ what: `${method}-step-result`, domain: "page-test-id", value: `"${method}-step-result"` }),
		...params.map((p) => setAs({ what: `${method}-step-input-${p}`, domain: "page-test-id", value: `"${method}-step-input-${p}"` })),
	];
}

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

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

		scenario({ scenario: "Enter graph data through the Step mode UI" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		click({ target: IDS.APP.TWISTY }),
		"page has settled",
		selectionOption({ option: '"Step"', field: IDS.APP.MODE_SELECT }),
		"page has settled",

		"Select createVertex step.",
		inputVariable({ what: '"create vertex"', field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
		"page has settled",
		waitFor({ target: `${CV}-step-input-label` }),

		"Create Tim Berners-Lee as a Researcher.",
		inputVariable({ what: '"Researcher"', field: `${CV}-step-input-label` }),
		inputVariable({ what: '"berners-lee"', field: `${CV}-step-input-id` }),
		inputVariable({ what: json({ name: "Tim Berners-Lee", context: "World Wide Web Foundation", published: "1989-03-12T00:00:00.000Z" }), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",
		waitFor({ target: `${CV}-step-result` }),

		"Create Manu Sporny as a Researcher.",
		inputVariable({ what: '"berners-lee"', field: `${CV}-step-input-id` }),
		inputVariable({ what: '"sporny"', field: `${CV}-step-input-id` }),
		inputVariable({ what: json({ name: "Manu Sporny", context: "Digital Bazaar / JSON-LD", published: "2010-06-01T00:00:00.000Z" }), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",
		waitFor({ target: `${CV}-step-result` }),

		"Create the Linked Data Platform paper.",
		inputVariable({ what: '"Paper"', field: `${CV}-step-input-label` }),
		inputVariable({ what: '"paper-ldp"', field: `${CV}-step-input-id` }),
		inputVariable({ what: json({ name: "Linked Data Platform", content: "Defines read-write linked data using HTTP and RDF. LDP containers enable CRUD operations over web resources with standard media types and link relations.", published: "2015-02-26T00:00:00.000Z" }), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",
		waitFor({ target: `${CV}-step-result` }),

		"Create the JSON-LD 1.1 specification paper.",
		inputVariable({ what: '"paper-jsonld"', field: `${CV}-step-input-id` }),
		inputVariable({ what: json({ name: "JSON-LD 1.1", content: "A JSON-based serialization for linked data. By embedding @context, existing JSON APIs become interoperable with RDF processors and semantic web tooling.", published: "2020-07-16T00:00:00.000Z" }), field: `${CV}-step-input-data` }),
		click({ target: `${CV}-step-run` }),
		"page has settled",
		waitFor({ target: `${CV}-step-result` }),

		"Link researchers to their papers via edges.",
		inputVariable({ what: '"create edge"', field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
		"page has settled",
		waitFor({ target: `${CE}-step-input-fromLabel` }),

		inputVariable({ what: '"Researcher"', field: `${CE}-step-input-fromLabel` }),
		inputVariable({ what: '"berners-lee"', field: `${CE}-step-input-fromId` }),
		inputVariable({ what: '"attributedTo"', field: `${CE}-step-input-rel` }),
		inputVariable({ what: '"Paper"', field: `${CE}-step-input-toLabel` }),
		inputVariable({ what: '"paper-ldp"', field: `${CE}-step-input-toId` }),
		click({ target: `${CE}-step-run` }),
		"page has settled",
		waitFor({ target: `${CE}-step-result` }),

		inputVariable({ what: '"sporny"', field: `${CE}-step-input-fromId` }),
		inputVariable({ what: '"paper-jsonld"', field: `${CE}-step-input-toId` }),
		click({ target: `${CE}-step-run` }),
		"page has settled",
		waitFor({ target: `${CE}-step-result` }),

		"Link LDP paper to JSON-LD as a reference.",
		inputVariable({ what: '"Paper"', field: `${CE}-step-input-fromLabel` }),
		inputVariable({ what: '"paper-ldp"', field: `${CE}-step-input-fromId` }),
		inputVariable({ what: '"inReplyTo"', field: `${CE}-step-input-rel` }),
		inputVariable({ what: '"paper-jsonld"', field: `${CE}-step-input-toId` }),
		click({ target: `${CE}-step-run` }),
		"page has settled",
		waitFor({ target: `${CE}-step-result` }),

		scenario({ scenario: "Query renders Researcher vertices" }),
		gotoPage({ name: `"${host}/spa?label=Researcher"` }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),

		scenario({ scenario: "Entity column shows researcher details and edges" }),
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),

		scenario({ scenario: "Paper entity via direct URL" }),
		gotoPage({ name: `"${host}/spa?label=Paper&id=paper-ldp"` }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),

		scenario({ scenario: "Incoming edge discovery" }),
		getIncomingEdges({ label: '"Paper"', id: '"paper-jsonld"', limit: '100', offset: '0' }),

		scenario({ scenario: "JSON-LD export" }),
		exportGraphAsJsonLd({}),

		scenario({ scenario: "Reload preserves navigation state" }),
		gotoPage({ name: `"${host}/spa?label=Researcher"` }),
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
		waitFor({ target: IDS.APP.TYPE_SELECT }),
		selectionOption({ option: '"Paper"', field: IDS.APP.TYPE_SELECT }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		waitFor({ target: IDS.QUERY.FIRST_ROW }),
	],
};
