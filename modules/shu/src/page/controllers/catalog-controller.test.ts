import { describe, it, expect, beforeEach } from "vitest";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { actorTypesFor, getEdgeRelMap, getSelectValues, getTypes, hasSelectValues } from "./catalog-controller.js";
import { declareSpec } from "../../test/catalog-fixture.js";
import { newPage } from "../../test/setup.js";

describe("a catalog read before actuality's steps", () => {
	beforeEach(() => newPage());

	it("throws and names what read it", () => {
		expect(() => getTypes()).toThrow("the types is read after actuality's steps: call getAvailableSteps() first");
	});
});

describe("the catalog of the registry the page holds", () => {
	beforeEach(() => declareSpec({ types: ["Email"] }));

	it("derives the registry's catalog once across 1,000 reads", () => {
		const first = getEdgeRelMap();
		for (let read = 0; read < 1000; read++) expect(getEdgeRelMap()).toBe(first);
	});

	it("derives a registry read again", () => {
		const first = getEdgeRelMap();
		declareSpec({ types: ["Email"] });
		expect(getEdgeRelMap()).not.toBe(first);
	});
});

describe("the dropdown values of a type", () => {
	it("throws where a view reads the dropdowns of a type the page didn't read them for", () => {
		expect(hasSelectValues("NeverFetched")).toBe(false);
		expect(() => getSelectValues("NeverFetched")).toThrow("the page reads the dropdown values of NeverFetched before it holds them");
	});
});

describe("the types an exchange is between", () => {
	// A hidden type isn't fetched, so the quads don't state its edges point at it. The declaration states so regardless, so a
	// view that needs actors brings them back and doesn't draw bars without a participant on them.
	beforeEach(() =>
		declareSpec({
			types: ["Permit"],
			rels: { Permit: { issuedBy: LinkRelations.FROM_ACTOR.rel, filedIn: LinkRelations.TO_ACTOR.rel, about: LinkRelations.ATTACHMENT.rel } },
			edgeRanges: { Permit: { issuedBy: ["Party"], filedIn: ["Registry"], about: ["Cargo"] } },
		}),
	);

	it("names a shown type's actor edges' targets, whether or not anything of those types has been read", () => {
		expect(actorTypesFor(["Permit"]).sort()).toEqual(["Party", "Registry"]);
	});

	it("doesn't name actor types for an empty list of shown types, so a view brings back only the parties of the types it shows", () => {
		expect(actorTypesFor([])).toEqual([]);
	});
});
