// @vitest-environment jsdom
// jsdom: the module defines a ShuElement (extends HTMLElement); the builders under test are pure metadata projections.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { buildTypeSchemaGraph, buildFullSchemaGraph, ShuTypeColumn } from "./shu-type-column.js";
import { getUiPresenting, setSiteMetadata, isSystemSchemaType, type SiteMetadata } from "../rels-cache.js";
import { paneAddressedBy } from "./ref-navigation.js";
import { NODE_KIND } from "../graph/types.js";
import { PaneState } from "../pane-state.js";
import { SHU_EVENT } from "../consts.js";

/** A two-type vocabulary: Issuer --assertionMethod--> VerificationMethod, both declaring a literal `name`. */
const META: SiteMetadata = {
	types: ["Issuer", "VerificationMethod"],
	idFields: { Issuer: "did", VerificationMethod: "id" },
	rels: {
		Issuer: { did: "identifier", name: "name", assertionMethod: "assertionMethod" },
		VerificationMethod: { id: "identifier", name: "name" },
	},
	edgeRanges: { Issuer: { assertionMethod: ["VerificationMethod"] } },
	properties: { Issuer: ["did", "name", "assertionMethod"], VerificationMethod: ["id", "name"] },
	queryable: {},
	validTimeFields: {},
	summary: {},
	ui: { "the-graph-view": { component: "site-graph-view", js: "/assets/site-graph-view.js", presents: "graph" } },
	propertyDefinitions: {},
};

beforeAll(() => setSiteMetadata(META));

const node = (g: ReturnType<typeof buildTypeSchemaGraph>, id: string) => g.nodes.find((n) => n.id === id);

describe("buildTypeSchemaGraph: one type's schema", () => {
	it("centres the type (highlighted), draws an edge per referenced type and a leaf per literal property", () => {
		const g = buildTypeSchemaGraph("Issuer");
		expect(node(g, "Issuer")?.kind).toBe(NODE_KIND.current);
		expect(node(g, "VerificationMethod")).toBeDefined();
		expect(g.edges).toContainEqual({ from: "Issuer", to: "VerificationMethod", label: "assertionMethod", rel: "assertionMethod" });
		expect(node(g, "prop:did")?.kind).toBe(NODE_KIND.argument);
		expect(node(g, "prop:assertionMethod")).toBeUndefined(); // an edge, not a literal leaf
	});

	it("links a type's node to the type's view, and a property's node to the type's records ordered by it", () => {
		const g = buildTypeSchemaGraph("Issuer");
		const opens = (id: string) => paneAddressedBy(node(g, id)?.link?.href ?? "");
		expect(opens("VerificationMethod")).toEqual({ paneType: "type", persistedAs: "VerificationMethod" });
		expect(opens("prop:name")).toEqual({ paneType: "filter-prop", persistedAs: "Issuer", predicate: "name" });
	});

	it("opens the view a pressed node links, and nothing for a press on the background", () => {
		if (!customElements.get("shu-type-column")) customElements.define("shu-type-column", ShuTypeColumn);
		const column = document.body.appendChild(new ShuTypeColumn());
		const opened = vi.spyOn(PaneState, "requestFrom").mockImplementation(() => undefined);
		const press = (graphNode: unknown) => column.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { node: graphNode }, bubbles: true, composed: true }));
		press(node(buildTypeSchemaGraph("Issuer"), "VerificationMethod"));
		press(null);
		expect(opened.mock.calls.map(([, pane]) => pane)).toEqual([{ paneType: "type", persistedAs: "VerificationMethod" }]);
		opened.mockRestore();
		column.remove();
	});
});

describe("buildFullSchemaGraph: the entire vocabulary with the viewed type highlighted", () => {
	it("includes every declared type, highlights only the viewed one", () => {
		const g = buildFullSchemaGraph("Issuer");
		expect(node(g, "Issuer")?.kind).toBe(NODE_KIND.current);
		expect(node(g, "VerificationMethod")).toBeDefined();
		expect(node(g, "VerificationMethod")?.kind).toBeUndefined();
	});

	it("shares one Property node between types that declare the same rel (a rel IS one Property)", () => {
		const g = buildFullSchemaGraph("Issuer");
		expect(g.nodes.filter((n) => n.id === "prop:name")).toHaveLength(1);
		const nameEdges = g.edges.filter((e) => e.to === "prop:name").map((e) => e.from);
		expect(nameEdges.sort()).toEqual(["Issuer", "VerificationMethod"]);
	});
});

describe("getUiPresenting, discovering the site's presenter for a capability", () => {
	it("finds the concern whose ui declares presents, and returns undefined for an undeclared capability", () => {
		expect(getUiPresenting("graph")).toEqual({ type: "the-graph-view", ui: { component: "site-graph-view", js: "/assets/site-graph-view.js", presents: "graph" } });
		expect(getUiPresenting("timeline")).toBeUndefined();
	});

	it("the type column prefers a dedicated schema presenter over the general graph presenter", () => {
		// The fixture declares only "graph": the schema lookup falls back to it. A site that also declares
		// presents:"schema" (the class browser) is chosen first, same accessor, keyed lookup.
		expect(getUiPresenting("schema") ?? getUiPresenting("graph")).toEqual(getUiPresenting("graph"));
	});

	it("flags a haibun-namespace type as a system schema, a standard-vocabulary type not", () => {
		setSiteMetadata({ ...META, classIris: { SeqPath: "hbn:SeqPath", VerifiableCredential: "cred:VerifiableCredential" } });
		expect(isSystemSchemaType("SeqPath")).toBe(true); // hbn: is haibun's own vocabulary
		expect(isSystemSchemaType("VerifiableCredential")).toBe(false); // cred: is a standard
		expect(isSystemSchemaType("Issuer")).toBe(false); // no declared class IRI
		setSiteMetadata(META);
	});
});
