import { withAction, type TKirejiExport } from "@haibun/core/kireji/withAction.js";
import WebPlaywright from "@haibun/web-playwright";
import TutorialGraphStepper from "@haibun/shu/tutorial-graph-stepper.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import Haibun from "@haibun/core/steps/haibun.js";
import { ShuStepper, SHU_TEST_IDS, createStepUI, stepTestIds, flattenTestIds } from "@haibun/shu";

const wp = new WebPlaywright();
const { getIncomingEdges, exportGraphAsJsonLd } = withAction(new TutorialGraphStepper());
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, click, selectionOption, gotoPage, reloadPage } = withAction(wp);
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const { enterStepMode, passesStepExecution } = createStepUI(wp);
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

const stepIdSetup = stepTestIds(["label", "id", "data", "fromLabel", "fromId", "rel", "toLabel", "toId"]).map((id) =>
	setAs({ what: id, domain: "page-test-id", value: `"${id}"` }),
);

const json = (obj: Record<string, unknown>) => `"${JSON.stringify(obj)}"`;

export const features: TKirejiExport = {
	"Hypermedia Tutorial: Rels, Edges, and HATEOAS": [
		feature({ feature: "Hypermedia Fundamentals through shu UI" }),

		...testIdSetup,
		...stepIdSetup,

		scenario({ scenario: "Start shu with empty graph" }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "shu-hypermedia-tutorial"',

		scenario({ scenario: "Enter graph data through the Step mode UI" }),
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",

		...enterStepMode,
		"Create Tim Berners-Lee as a Researcher.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Researcher"',
			id: '"berners-lee"',
			data: json({
				name: "Tim Berners-Lee",
				context: "World Wide Web Foundation",
				published: "1989-03-12T00:00:00.000Z",
			}),
		}),

		"Create Manu Sporny as a Researcher.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Researcher"',
			id: '"sporny"',
			data: json({
				name: "Manu Sporny",
				context: "Digital Bazaar / JSON-LD",
				published: "2010-06-01T00:00:00.000Z",
			}),
		}),

		"Create the Linked Data Platform paper.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Paper"',
			id: '"paper-ldp"',
			data: json({
				name: "Linked Data Platform",
				content: "Defines read-write linked data using HTTP and RDF. LDP containers enable CRUD operations over web resources with standard media types and link relations.",
				published: "2015-02-26T00:00:00.000Z",
			}),
		}),

		"Create the JSON-LD 1.1 specification paper.",
		...passesStepExecution("TutorialGraphStepper-createVertex", {
			label: '"Paper"',
			id: '"paper-jsonld"',
			data: json({
				name: "JSON-LD 1.1",
				content: "A JSON-based serialization for linked data. By embedding @context, existing JSON APIs become interoperable with RDF processors and semantic web tooling.",
				published: "2020-07-16T00:00:00.000Z",
			}),
		}),

		"Link researchers to their papers via edges.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Researcher"',
			fromId: '"berners-lee"',
			rel: '"attributedTo"',
			toLabel: '"Paper"',
			toId: '"paper-ldp"',
		}),
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Researcher"',
			fromId: '"sporny"',
			rel: '"attributedTo"',
			toLabel: '"Paper"',
			toId: '"paper-jsonld"',
		}),

		"Link LDP paper to JSON-LD as a reference.",
		...passesStepExecution("TutorialGraphStepper-createEdge", {
			fromLabel: '"Paper"',
			fromId: '"paper-ldp"',
			rel: '"inReplyTo"',
			toLabel: '"Paper"',
			toId: '"paper-jsonld"',
		}),

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
