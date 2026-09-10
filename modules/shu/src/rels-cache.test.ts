import { describe, it, expect, beforeEach } from "vitest";
import { actorTypesFor, addObservedSelectValues, getSelectValues, setConcernCatalog, setSelectValues, siteMetadataFromConcerns } from "./rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { ConcernCatalogSchema, type TConcernCatalog } from "@haibun/core/lib/hypermedia.js";

describe("siteMetadataFromConcerns, propertyDefinitions derivation", () => {
	it("populates propertyDefinitions from LinkRelations seeds", () => {
		const emptyCatalog: TConcernCatalog = { persisted: {}, references: {} };
		const meta = siteMetadataFromConcerns(emptyCatalog);
		// The seed includes the canonical body/governance/summary rels.
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

/** A live quad, with only what the dropdowns read off it. */
const quad = (namedGraph: string, predicate: string, object: unknown): TQuad => ({ subject: "s1", predicate, object, namedGraph, timestamp: 1 }) as TQuad;

describe("dropdowns learning from the quads a batch carries", () => {
	// A value that has newly appeared is IN the quad that announced it. Taking it from there is what lets a view stay
	// current without asking the server again, and asking again is what made a view of the run's own records feed
	// itself, since the question is dispatched as a step and the step is recorded as another change to answer.
	beforeEach(() => setSelectValues("Email", { folder: ["INBOX"], status: [] }));

	it("adds a value the batch announced, and says it changed", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", "Archive")])).toBe(true);
		expect(getSelectValues("Email").folder).toEqual(["Archive", "INBOX"]);
	});

	it("fills a dropdown that was offered but had no values yet", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "status", "read")])).toBe(true);
		expect(getSelectValues("Email").status).toEqual(["read"]);
	});

	it("says nothing changed when the value is already offered, so a view does not re-render for nothing", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", "INBOX")])).toBe(false);
	});

	it("ignores a quad about another type, whose values belong to another dropdown", () => {
		expect(addObservedSelectValues("Email", [quad("SeqPath", "folder", "elsewhere")])).toBe(false);
		expect(getSelectValues("Email").folder).toEqual(["INBOX"]);
	});

	it("ignores a predicate this type does not offer as a dropdown, which the type's own declaration decides", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "subject", "a subject line")])).toBe(false);
		expect(getSelectValues("Email").subject).toBeUndefined();
	});

	it("adds nothing for a type never fetched, since nothing yet says which of its fields are dropdowns", () => {
		expect(addObservedSelectValues("NeverFetched", [quad("NeverFetched", "folder", "INBOX")])).toBe(false);
		expect(getSelectValues("NeverFetched")).toEqual({});
	});

	it("ignores an object that is not a value a dropdown can offer", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", 42), quad("Email", "folder", "")])).toBe(false);
		expect(getSelectValues("Email").folder).toEqual(["INBOX"]);
	});
});

describe("the types an exchange is between", () => {
	// A hidden type is not fetched, so nothing in the quads says its edges point at it. The declaration says so
	// regardless, which is what lets a view that needs actors bring them back rather than draw bars with nobody on them.
	it("names a shown type's actor edges' targets, whether or not anything of those types has been read", () => {
		const catalog = ConcernCatalogSchema.parse({
			persisted: {
				Permit: {
					domainKey: "permit",
					label: "Permit",
					idField: "id",
					jsonSchema: {},
					properties: {},
					validTimeField: "generatedAtTime",
					description: "a permit",
					edges: {
						issuedBy: { term: "ex:issuedBy", rel: LinkRelations.FROM_ACTOR.rel, target: "Party" },
						filedIn: { term: "ex:filedIn", rel: LinkRelations.TO_ACTOR.rel, target: "Registry" },
						about: { term: "ex:about", rel: LinkRelations.ATTACHMENT.rel, target: "Cargo" },
					},
				},
			},
		});
		setConcernCatalog(catalog);
		expect(actorTypesFor(["Permit"]).sort()).toEqual(["Party", "Registry"]);
	});

	it("says nothing of a type that is not being shown, so choosing a view brings back only the parties of what is", () => {
		expect(actorTypesFor([])).toEqual([]);
	});
});
