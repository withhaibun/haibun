import { withAction, type TKirejiExport, } from "@haibun/core/kireji/withAction.js";
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
		else if (typeof value === "object" && value !== null)
			result.push(...flattenTestIds(value as Record<string, unknown>));
	}
	return result;
}

const { getIncomingEdges, exportGraphAsJsonLd } = withAction(new TutorialGraphStepper(),);
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, click, selectionOption, inputVariable, press, gotoPage, reloadPage, } = withAction(new WebPlaywright());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) =>
	setAs({ what: id, domain: "page-test-id", value: `"${id}"` }),
);


const currentStepIds = [
	"current-step-run", "current-step-result", "current-step-error",
].map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

function currentInputIds(params: string[]) {
	return params.map((p) => setAs({ what: `current-step-input-${p}`, domain: "page-test-id", value: `"current-step-input-${p}"` }));
}

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

function selectStep(stepName: string) {
	return [
		click({ target: IDS.APP.STEP_SELECT }),
		inputVariable({ what: `"${stepName}"`, field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
	];
}

export const features: TKirejiExport = {
	"Hypermedia Tutorial: Rels, Edges, and HATEOAS": [
		feature({ feature: "Hypermedia Fundamentals through shu UI" }),

		...testIdSetup,
		...currentStepIds,
		...currentInputIds(["label", "id", "data", "fromLabel", "fromId", "rel", "toLabel", "toId"]),

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
		waitFor({ target: `current-step-input-label` }),

		"Create Tim Berners-Lee as a Researcher.",
		inputVariable({ what: '"Researcher"', field: `current-step-input-label` }),
		inputVariable({ what: '"berners-lee"', field: `current-step-input-id` }),
		inputVariable({
			what: json({
				name: "Tim Berners-Lee",
				context: "World Wide Web Foundation",
				published: "1989-03-12T00:00:00.000Z",
			}),
			field: `current-step-input-data`,
		}),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		"Create Manu Sporny as a Researcher.",
		...selectStep("create vertex"),
		waitFor({ target: `current-step-input-label` }),
		inputVariable({ what: '"Researcher"', field: `current-step-input-label` }),
		inputVariable({ what: '"sporny"', field: `current-step-input-id` }),
		inputVariable({
			what: json({
				name: "Manu Sporny",
				context: "Digital Bazaar / JSON-LD",
				published: "2010-06-01T00:00:00.000Z",
			}),
			field: `current-step-input-data`,
		}),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		"Create the Linked Data Platform paper.",
		...selectStep("create vertex"),
		waitFor({ target: `current-step-input-label` }),
		inputVariable({ what: '"Paper"', field: `current-step-input-label` }),
		inputVariable({ what: '"paper-ldp"', field: `current-step-input-id` }),
		inputVariable({
			what: json({
				name: "Linked Data Platform",
				content:
					"Defines read-write linked data using HTTP and RDF. LDP containers enable CRUD operations over web resources with standard media types and link relations.",
				published: "2015-02-26T00:00:00.000Z",
			}),
			field: `current-step-input-data`,
		}),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		"Create the JSON-LD 1.1 specification paper.",
		...selectStep("create vertex"),
		waitFor({ target: `current-step-input-label` }),
		inputVariable({ what: '"Paper"', field: `current-step-input-label` }),
		inputVariable({ what: '"paper-jsonld"', field: `current-step-input-id` }),
		inputVariable({
			what: json({
				name: "JSON-LD 1.1",
				content:
					"A JSON-based serialization for linked data. By embedding @context, existing JSON APIs become interoperable with RDF processors and semantic web tooling.",
				published: "2020-07-16T00:00:00.000Z",
			}),
			field: `current-step-input-data`,
		}),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		"Link researchers to their papers via edges.",
		inputVariable({ what: '"create edge"', field: IDS.APP.STEP_SELECT }),
		press({ key: '"Enter"' }),
		"page has settled",
		waitFor({ target: `current-step-input-fromLabel` }),

		inputVariable({
			what: '"Researcher"',
			field: `current-step-input-fromLabel`,
		}),
		inputVariable({ what: '"berners-lee"', field: `current-step-input-fromId` }),
		inputVariable({ what: '"attributedTo"', field: `current-step-input-rel` }),
		inputVariable({ what: '"Paper"', field: `current-step-input-toLabel` }),
		inputVariable({ what: '"paper-ldp"', field: `current-step-input-toId` }),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		...selectStep("create edge"),
		waitFor({ target: `current-step-input-fromLabel` }),
		inputVariable({ what: '"Researcher"', field: `current-step-input-fromLabel` }),
		inputVariable({ what: '"sporny"', field: `current-step-input-fromId` }),
		inputVariable({ what: '"attributedTo"', field: `current-step-input-rel` }),
		inputVariable({ what: '"Paper"', field: `current-step-input-toLabel` }),
		inputVariable({ what: '"paper-jsonld"', field: `current-step-input-toId` }),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

		"Link LDP paper to JSON-LD as a reference.",
		...selectStep("create edge"),
		waitFor({ target: `current-step-input-fromLabel` }),
		inputVariable({ what: '"Paper"', field: `current-step-input-fromLabel` }),
		inputVariable({ what: '"paper-ldp"', field: `current-step-input-fromId` }),
		inputVariable({ what: '"inReplyTo"', field: `current-step-input-rel` }),
		inputVariable({ what: '"paper-jsonld"', field: `current-step-input-toId` }),
		click({ target: `current-step-run` }),
		"page has settled",
		waitFor({ target: `current-step-result` }),

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
		getIncomingEdges({
			label: '"Paper"',
			id: '"paper-jsonld"',
			limit: "100",
			offset: "0",
		}),

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
