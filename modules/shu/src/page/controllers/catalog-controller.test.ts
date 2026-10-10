import { describe, it, expect, beforeEach } from "vitest";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { actorTypesFor, addObservedSelectValues, getEdgeRelMap, getSelectValues, getTypes, hasSelectValues, setSelectValues } from "./catalog-controller.js";
import { declareSpec } from "../../test/catalog-fixture.js";
import { newPage } from "../../test-setup.js";

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

/** A live quad, with only what the dropdowns read off it. */
const quad = (namedGraph: string, predicate: string, object: unknown): TQuad => ({ subject: "s1", predicate, object, namedGraph, timestamp: 1 }) as TQuad;

describe("the dropdown values the quads of a batch add", () => {
	// A value that appears is in the quad that carries it. Taking it from the quad keeps a view current without a second
	// read. A second read would make a view of actuality's own records feed itself, since the read is dispatched as a step
	// and actuality records the step as another change.
	beforeEach(() => setSelectValues("Email", { folder: ["INBOX"], status: [] }));

	it("adds a value the batch announced, and reports it changed", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", "Archive")])).toBe(true);
		expect(getSelectValues("Email").folder).toEqual(["Archive", "INBOX"]);
	});

	it("fills a dropdown that was offered but didn't have values yet", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "status", "read")])).toBe(true);
		expect(getSelectValues("Email").status).toEqual(["read"]);
	});

	it("reports the dropdowns didn't change when the value is already offered, so a view doesn't draw again without a change", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", "INBOX")])).toBe(false);
	});

	it("ignores a quad of another type, whose values are another dropdown's", () => {
		expect(addObservedSelectValues("Email", [quad("SeqPath", "folder", "elsewhere")])).toBe(false);
		expect(getSelectValues("Email").folder).toEqual(["INBOX"]);
	});

	it("ignores a predicate the type doesn't declare as a dropdown", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "subject", "a subject line")])).toBe(false);
		expect(getSelectValues("Email").subject).toBeUndefined();
	});

	it("doesn't add a value for a type whose dropdowns the page doesn't hold, and throws where a view reads them", () => {
		expect(addObservedSelectValues("NeverFetched", [quad("NeverFetched", "folder", "INBOX")])).toBe(false);
		expect(hasSelectValues("NeverFetched")).toBe(false);
		expect(() => getSelectValues("NeverFetched")).toThrow("the page reads the dropdown values of NeverFetched before it holds them");
	});

	it("ignores an object that isn't a value a dropdown can offer", () => {
		expect(addObservedSelectValues("Email", [quad("Email", "folder", 42), quad("Email", "folder", "")])).toBe(false);
		expect(getSelectValues("Email").folder).toEqual(["INBOX"]);
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
