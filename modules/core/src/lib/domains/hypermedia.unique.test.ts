/**
 * The sets of properties a type declares unique. A store compares the values a record's properties hold, so a set names one or
 * more of the type's properties.
 */
import { describe, it, expect } from "vitest";
import { uniqueFieldsOf } from "./hypermedia.js";
import { Access, LinkRelations, type THypermediaTopology } from "./resources.js";

const declaring = (unique: readonly (readonly string[])[]): THypermediaTopology => ({
	persistedAs: "Placed",
	accessLevel: Access.private,
	id: "id",
	properties: { id: LinkRelations.IDENTIFIER.rel, list: LinkRelations.CONTEXT.rel, place: LinkRelations.CONTEXT.rel },
	unique,
});

describe("the sets of properties a type declares unique", () => {
	it("returns each set of declared properties", () => {
		expect(uniqueFieldsOf("Placed", declaring([["list", "place"]]))).toEqual([["list", "place"]]);
	});

	it("refuses an empty set and a field the type doesn't declare as a property", () => {
		expect(() => uniqueFieldsOf("Placed", declaring([[]]))).toThrow("Placed declares an empty unique set");
		expect(() => uniqueFieldsOf("Placed", declaring([["list", "shelf"]]))).toThrow("Placed declares [list, shelf] unique, and shelf isn't one of its properties");
	});
});
