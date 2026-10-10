import { describe, it, expect } from "vitest";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { commentDomainDefinition } from "@haibun/core/lib/resources.js";
import { catalogOf, rangeOf, type TCatalogSource } from "./catalog.js";
import { catalogOf as specCatalog } from "../../test/catalog-fixture.js";

const sourceOf = (concerns: TCatalogSource["concerns"]): TCatalogSource => ({ concerns, domains: {} });
const EMPTY = sourceOf({ persisted: {}, references: {} });

describe("the relations' definitions a catalog derives", () => {
	it("states the core relations' presentation and the RDFS relations", () => {
		const { propertyDefinitions } = catalogOf(EMPTY);
		expect(propertyDefinitions.hasBody?.presentation).toBe("body");
		expect(propertyDefinitions.accessLevel?.presentation).toBe("governance");
		expect(propertyDefinitions.name?.presentation).toBe("summary");
		for (const rel of ["subPropertyOf", "label", "range", "icon", "presentation"]) expect(propertyDefinitions[rel], rel).toBeDefined();
	});

	it("states each declared subPropertyOf link", () => {
		const { propertyDefinitions } = catalogOf(EMPTY);
		for (const rel of ["wasInformedBy", "invalidated", "madeBySensor", "wasStartedBy"]) expect(propertyDefinitions[rel]?.subPropertyOf, rel).toBe("inReplyTo");
	});
});

describe("the range of a field (HM17)", () => {
	const source = sourceOf(specCatalog({ types: ["Email"], rels: { Email: { messageId: "identifier", sender: "attributedTo", subject: "name" } } }));

	it("reads a field whose relation points at a record as an iri, and a named field as a literal", () => {
		expect(rangeOf(catalogOf(source), "Email", "sender")).toBe("iri");
		expect(rangeOf(catalogOf(source), "Email", "subject")).toBe("literal");
	});

	it("reads an edge's range from the relation the edge declares", () => {
		const withEdge = sourceOf(specCatalog({ types: ["Email", "Person"], rels: { Email: { sender: "attributedTo" } }, edgeRanges: { Email: { sender: ["Person"] } } }));
		expect(catalogOf(withEdge).fieldRels.Email?.sender).toBe("attributedTo");
		expect(rangeOf(catalogOf(withEdge), "Email", "sender")).toBe("iri");
	});

	it("doesn't state a range for a field the type doesn't declare", () => {
		expect(rangeOf(catalogOf(source), "Email", "undeclared")).toBeUndefined();
	});
});

describe("one derivation per catalog (SH27)", () => {
	it("derives a catalog once across 1,000 reads", () => {
		const source = sourceOf(buildConcernCatalog(mapDefinitionsToDomains([commentDomainDefinition])));
		const first = catalogOf(source);
		for (let read = 0; read < 1000; read++) expect(catalogOf(source)).toBe(first);
	});

	it("derives a new catalog again, by being new", () => {
		const concerns = buildConcernCatalog(mapDefinitionsToDomains([commentDomainDefinition]));
		expect(catalogOf(sourceOf(concerns))).not.toBe(catalogOf(sourceOf(concerns)));
	});
});
