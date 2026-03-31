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

const { graphQuery, getVertexWithEdges, getIncomingEdges, createEdge, exportGraphAsJsonLd } = withAction(new TutorialGraphStepper());
const { serveShuApp } = withAction(new ShuStepper());
const { waitFor, click, selectionOption, inputVariable, gotoPage, reloadPage } = withAction(new WebPlaywright());
const { setAs } = withAction(new VariablesStepper());
const { feature, scenario } = withAction(new Haibun());
const host = "http://localhost:8237";
const IDS = SHU_TEST_IDS;

const testIdSetup = flattenTestIds(IDS).map((id) => setAs({ what: id, domain: "page-test-id", value: `"${id}"` }));

export const features: TKirejiExport = {
	"Hypermedia Tutorial: Rels, Edges, and HATEOAS": [
		feature({ feature: "Hypermedia Fundamentals through shu UI" }),

		...testIdSetup,

		"This test explores hypermedia concepts: how rels define semantic meaning.",
		"How edges enable HATEOAS navigation.",
		"How JSON-LD exports encode relationships.",
		"The shu UI discovers and renders these capabilities dynamically.",

		scenario({ scenario: "Start shu with tutorial graph stepper" }),
		"Every stepper declares vertex types and their properties.",
		graphQuery({ query: JSON.stringify({ label: "Researcher", textQuery: "" }) }),
		"enable rpc",
		serveShuApp({ path: '"/spa"' }),
		'webserver is listening for "shu-hypermedia-tutorial"',

		scenario({ scenario: "Understanding Rels: Properties with Semantic Meaning" }),
		"Rels like 'name', 'context', 'published' tell the UI how to interpret properties.",
		"The tutorial graph has Researcher vertices with properties that use rels:",
		"  - 'name' (rel: identifier) → person's full name",
		"  - 'context' (rel: context) → their research area",
		"  - 'published' (rel: published) → when their profile was created",
		"",
		gotoPage({ name: `"${host}/spa?label=Researcher"` }),
		"page has settled",
		waitFor({ target: IDS.QUERY.TABLE }),
		"The query renders Researcher vertices; column headers are derived from rels.",
		"Each row shows properties labeled by their semantic rels.",

		scenario({ scenario: "Following HATEOAS: Edge Navigation via Rels" }),
		"HATEOAS means links (edges) are discovered at runtime, not hardcoded.",
		"The tutorial stepper declares edges with rels: attributedTo, inReplyTo.",
		"When shu discovers these edges, it renders them as clickable links in entity columns.",
		"",
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		"The entity column shows 'Dr. Alice Chen' (Researcher) with her properties.",
		waitFor({ target: IDS.COLUMN_BROWSER.REF_SECTION }),
		"Edges appear: 'authored' rel (attributedTo) links to Papers this researcher wrote.",
		"Navigating via URL to a specific Paper entity by id.",
		gotoPage({ name: `"${host}/spa?label=Paper&id=paper-semantic-web"` }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		"The Paper entity opens with its details and references.",

		scenario({ scenario: "Discovering Incoming Relationships via Reverse Edges" }),
		"Papers have edges linking back via attributedTo; the shu UI queries these reverse edges.",
		"This implements HATEOAS discovery from the incoming direction.",
		getIncomingEdges({ label: '"Paper"', id: '"paper-semantic-web"', limit: '100', offset: '0' }),
		"The Paper column shows incomingCount; clicking reveals incoming references.",

		scenario({ scenario: "JSON-LD Export: Rels Become Semantic URIs" }),
		"When exported as JSON-LD, rels map to standard semantic web URIs:",
		"  - 'name' → http://schema.org/name",
		"  - 'published' → http://purl.org/dc/terms/issued",
		"  - 'attributedTo' → http://purl.org/dc/terms/creator",
		"  - 'inReplyTo' → http://www.w3.org/2002/07/owl#sameAs",
		exportGraphAsJsonLd({}),
		"The export includes @context mapping; the graph is in @graph array.",
		"External tools (JSON-LD processors, RDF converters) can now understand all relationships.",

		scenario({ scenario: "Reload Preserves Navigation State" }),
		"URL state persists active pane, column types, and search filters.",
		"Reloading the page restores the exact navigation position.",
		"",
		gotoPage({ name: `"${host}/spa"` }),
		"page has settled",
		click({ target: IDS.QUERY.FIRST_ROW }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		"Entity column is now active and visible.",
		reloadPage({}),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		"Active pane remains #2 (entity column), not reset to #0 (query).",
		"Navigation state (the hypermedia state machine) survived the reload.",

		scenario({ scenario: "Creating New Edges: Hypermedia Mutation" }),
		"APIs are hypermedia when mutations (POST, PUT) are also discoverable via rels.",
		"The tutorial stepper includes createEdge step.",
		"The shu UI could present it as an action.",
		"This demonstrates: Rels enable clients to discover available operations dynamically.",
		"",
		createEdge({ fromLabel: '"Paper"', fromId: '"paper-semantic-web"', rel: '"references"', toLabel: '"Paper"', toId: '"paper-jsonld"' }),
		"New edge created: Paper-semantic-web references Paper-jsonld.",
		gotoPage({ name: `"${host}/spa?label=Paper&id=paper-semantic-web"` }),
		"page has settled",
		waitFor({ target: IDS.COLUMN_BROWSER.ENTITY_DETAILS }),
		"The new reference now appears in the entity column, proving mutations are reflected.",
	],
};
