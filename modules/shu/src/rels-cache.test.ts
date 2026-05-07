import { describe, it, expect, beforeEach } from "vitest";
import { setSiteMetadata, getPropertyDefinition, getRelLabel, getRelIcon, siteMetadataFromConcerns } from "./rels-cache.js";
import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";

describe("rels-cache property accessors", () => {
	beforeEach(() => {
		setSiteMetadata({
			types: ["Email"],
			idFields: { Email: "id" },
			rels: { Email: { id: "identifier" } },
			edgeRanges: {},
			properties: { Email: ["id"] },
			summary: {},
			ui: {},
			propertyDefinitions: {
				hasBody: { iri: "oa:hasBody", range: "iri", presentation: "body", icon: "📦", label: "Body" },
				inReplyTo: { iri: "as:inReplyTo", range: "iri" },
				wasInformedBy: { iri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
			},
		});
	});

	it("getPropertyDefinition returns the cached entry", () => {
		const def = getPropertyDefinition("hasBody");
		expect(def?.iri).toBe("oa:hasBody");
		expect(def?.presentation).toBe("body");
		expect(def?.icon).toBe("📦");
	});

	it("getPropertyDefinition returns undefined for unknown rels", () => {
		expect(getPropertyDefinition("totallyMadeUp")).toBeUndefined();
	});

	it("getRelLabel falls back to the rel name when no label is declared", () => {
		expect(getRelLabel("inReplyTo")).toBe("inReplyTo");
	});

	it("getRelLabel returns the declared label when present", () => {
		expect(getRelLabel("hasBody")).toBe("Body");
	});

	it("getRelIcon returns the declared icon, or undefined", () => {
		expect(getRelIcon("hasBody")).toBe("📦");
		expect(getRelIcon("inReplyTo")).toBeUndefined();
	});

	it("propertyDefinitions exposes subPropertyOf", () => {
		expect(getPropertyDefinition("wasInformedBy")?.subPropertyOf).toBe("inReplyTo");
	});
});

describe("siteMetadataFromConcerns — propertyDefinitions derivation", () => {
	it("populates propertyDefinitions from LinkRelations seeds", () => {
		const emptyCatalog: TConcernCatalog = { vertices: {} };
		const meta = siteMetadataFromConcerns(emptyCatalog);
		// Sanity: the seed includes the canonical body/governance/summary rels.
		expect(meta.propertyDefinitions.hasBody?.presentation).toBe("body");
		expect(meta.propertyDefinitions.accessLevel?.presentation).toBe("governance");
		expect(meta.propertyDefinitions.name?.presentation).toBe("summary");
		// And the new RDFS rels are present.
		expect(meta.propertyDefinitions.subPropertyOf).toBeDefined();
		expect(meta.propertyDefinitions.label).toBeDefined();
		expect(meta.propertyDefinitions.range).toBeDefined();
		expect(meta.propertyDefinitions.icon).toBeDefined();
		expect(meta.propertyDefinitions.presentation).toBeDefined();
	});

	it("propagates declared subPropertyOf links", () => {
		const emptyCatalog: TConcernCatalog = { vertices: {} };
		const meta = siteMetadataFromConcerns(emptyCatalog);
		expect(meta.propertyDefinitions.wasInformedBy?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.invalidated?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.madeBySensor?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.wasStartedBy?.subPropertyOf).toBe("inReplyTo");
	});
});
