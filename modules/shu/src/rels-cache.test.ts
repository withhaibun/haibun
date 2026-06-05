import { describe, it, expect, beforeEach } from "vitest";
import { siteMetadataFromConcerns } from "./rels-cache.js";
import type { TConcernCatalog } from "@haibun/core/lib/hypermedia.js";

describe("siteMetadataFromConcerns — propertyDefinitions derivation", () => {
	it("populates propertyDefinitions from LinkRelations seeds", () => {
		const emptyCatalog: TConcernCatalog = { persisted: {}, references: {} };
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
		const emptyCatalog: TConcernCatalog = { persisted: {}, references: {} };
		const meta = siteMetadataFromConcerns(emptyCatalog);
		expect(meta.propertyDefinitions.wasInformedBy?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.invalidated?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.madeBySensor?.subPropertyOf).toBe("inReplyTo");
		expect(meta.propertyDefinitions.wasStartedBy?.subPropertyOf).toBe("inReplyTo");
	});
});
