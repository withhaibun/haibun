/**
 * The members a view holds, as the block a page carries states them.
 *
 * A view describes what a reader is looking at while they look at it. Nothing persists it, so the block carries no
 * vocabulary type, and it keeps its `@id` so a reader reads statements about that subject. The builder validates as it
 * builds, so a view that states its members states them the one way or raises where it is written.
 */
import { describe, it, expect } from "vitest";
import { ViewCollectionSchema, viewCollection } from "./hypermedia.js";

describe("a view's collection", () => {
	it("states the members under items, counts them, and claims no type", () => {
		const built = viewCollection({ id: "view:query", name: "the search results shown in this column", items: [{ at: 0 }, { at: 1 }] });
		expect(built).toEqual({ "@id": "view:query", name: "the search results shown in this column", items: [{ at: 0 }, { at: 1 }], totalItems: 2 });
		expect(built["@type"], "nothing persists a view, so the block states no type").toBeUndefined();
	});

	it("keeps the count a view states where the view holds more than it carries", () => {
		expect(viewCollection({ id: "view:result-table", name: "the rows this table shows", items: [{ at: 0 }], totalItems: 4000 }).totalItems).toBe(4000);
	});

	it("carries what else the view states beside its members", () => {
		const built = viewCollection({ id: "view:query", name: "the search results shown in this column", items: [], stated: { queryType: "Email", textQuery: "bakery" } });
		expect(built.queryType).toBe("Email");
		expect(built.textQuery).toBe("bakery");
	});

	it("doesn't let what a view states replace the members or the count it was built from", () => {
		const built = viewCollection({ id: "view:query", name: "a name", items: [{ at: 0 }], stated: { items: [], totalItems: 99, "@id": "view:other" } });
		expect(built.items).toEqual([{ at: 0 }]);
		expect(built.totalItems).toBe(1);
		expect(built["@id"]).toBe("view:query");
	});

	it("raises where a block states members without an address, a name or a count", () => {
		expect(() => ViewCollectionSchema.parse({ name: "a name", items: [], totalItems: 0 })).toThrow();
		expect(() => ViewCollectionSchema.parse({ "@id": "view:query", items: [], totalItems: 0 })).toThrow();
		expect(() => ViewCollectionSchema.parse({ "@id": "view:query", name: "a name", items: [] }), "a count of nothing is a count, and an absent one is not").toThrow();
		expect(() => ViewCollectionSchema.parse({ "@id": "", name: "a name", items: [], totalItems: 0 }), "an empty address names no view").toThrow();
	});
});
