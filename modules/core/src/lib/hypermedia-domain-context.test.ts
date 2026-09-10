import { describe, it, expect } from "vitest";
import { hypermediaDomainFromContext, buildConcernCatalog } from "./hypermedia.js";
import { LinkRelations, REL_CONTEXT } from "./resources.js";
import { toRegisteredDomain, objectCoercer } from "./domains.js";

const iri = (rel: string) => REL_CONTEXT[rel];

describe("hypermediaDomainFromContext, declare a hypermedia domain from a JSON-LD @context", () => {
	it("builds the Ingredient topology + raw schema (recipe model)", () => {
		const { topology, schema } = hypermediaDomainFromContext("Ingredient", {
			"@context": {
				id: "@id",
				name: iri(LinkRelations.NAME.rel),
				usedIn: { "@id": iri(LinkRelations.PART_OF.rel), range: "Recipe" },
			},
			"@queryable": ["name"],
		});
		expect(topology.id).toBe("id");
		expect(topology.properties.id).toBe(LinkRelations.IDENTIFIER.rel);
		expect(topology.properties.name).toBe(LinkRelations.NAME.rel);
		expect(topology.properties.generatedAtTime).toBe(LinkRelations.GENERATED_AT_TIME.rel); // auto-injected
		expect(topology.edges?.usedIn).toEqual({ range: "Recipe", rel: LinkRelations.PART_OF.rel });
		expect(topology.sortColumns).toEqual({ name: "TEXT" });
		// raw create data validates; generatedAtTime defaults; extras rejected (strict)
		expect(schema.safeParse({ id: "chickpeas", name: "Chickpeas" }).success).toBe(true);
		expect(schema.safeParse({ id: "x", name: "X", bogus: 1 }).success).toBe(false);
		// round-trips through the concern catalog (identifier + single-generatedAtTime invariants hold)
		const cat = buildConcernCatalog({
			ingredient: toRegisteredDomain({
				selectors: ["ingredient"],
				schema,
				coerce: objectCoercer(schema),
				description: "An ingredient used in recipes.",
				topology,
				ui: { declared: true },
			}),
		});
		expect(cat.persisted.Ingredient.idField).toBe("id");
		expect(cat.persisted.Ingredient.edges.usedIn.target).toBe("Recipe");
	});

	it("requires an @id field: a type is invalid without an identifier", () => {
		expect(() => hypermediaDomainFromContext("Bad", { "@context": { name: iri(LinkRelations.NAME.rel) } })).toThrow(/@id/);
	});

	it("types fields via @type (xsd:integer → number/BIGINT)", () => {
		const { topology, schema } = hypermediaDomainFromContext("Item", {
			"@context": { id: "@id", qty: { "@id": iri(LinkRelations.NAME.rel), "@type": "xsd:integer" } },
			"@queryable": ["qty"],
		});
		expect(schema.safeParse({ id: "a", qty: 3 }).success).toBe(true);
		expect(schema.safeParse({ id: "a", qty: "three" }).success).toBe(false);
		expect(topology.sortColumns?.qty).toBe("BIGINT");
	});
});
