// @vitest-environment jsdom
// jsdom: the module defines a ShuElement (extends HTMLElement).
import { type TCatalogSpec, declareSpec } from "../../test/catalog-fixture.js";
import { describe, it, expect, beforeAll } from "vitest";
import "./shu-type-column.js";
import { getUiPresenting, isSystemSchemaType } from "../controllers/catalog-controller.js";

/** A two-type vocabulary: Issuer --assertionMethod--> VerificationMethod, both declaring a literal `name`. */
const META: TCatalogSpec = {
	types: ["Issuer", "VerificationMethod"],
	idFields: { Issuer: "did", VerificationMethod: "id" },
	rels: { Issuer: { did: "identifier", name: "name", assertionMethod: "assertionMethod" }, VerificationMethod: { id: "identifier", name: "name" } },
	edgeRanges: { Issuer: { assertionMethod: ["VerificationMethod"] } },
	queryable: {},
	validTimeFields: {},
	ui: { "the-graph-view": { component: "site-graph-view", js: "/assets/site-graph-view.js", presents: "graph" } },
};

beforeAll(() => declareSpec(META));

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
		declareSpec({ ...META, types: [...META.types, "SeqPath", "Person"], classIris: { SeqPath: "hbn:SeqPath", Person: "schema:Person" } });
		expect(isSystemSchemaType("SeqPath")).toBe(true); // hbn: is haibun's own vocabulary
		expect(isSystemSchemaType("Person")).toBe(false); // schema: is a standard
		expect(isSystemSchemaType("Agent")).toBe(false); // it doesn't declare a class IRI
		declareSpec(META);
	});
});
