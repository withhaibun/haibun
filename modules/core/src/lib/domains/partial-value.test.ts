import { describe, expect, it } from "vitest";
import { partialDifference } from "./partial-value.js";

describe("a partial value", () => {
	it("holds where each expected key holds its value, a string as a pattern, and a list item by item", () => {
		const actual = { refusal: "the caller doesn't hold TrustedList:withdrawAnchor", seqPath: "0.1.2", count: 2, items: [{ id: "a", n: 1 }, { id: "b" }] };
		expect(partialDifference({ refusal: "*withdrawAnchor*" }, actual, "products")).toBeUndefined();
		expect(partialDifference({ count: 2, items: [{ id: "a" }, { id: "b*" }] }, actual, "products")).toBeUndefined();
		expect(partialDifference({ items: '*"id":"b"*' }, actual, "products"), "a pattern matches the JSON of a value that isn't a string").toBeUndefined();
	});

	it("names the path of the first difference: a missing key, a different value, a pattern it doesn't match, or a list of another length", () => {
		const actual = { refusal: "not permitted", count: 2, items: [{ id: "a" }] };
		expect(partialDifference({ seqPath: "*" }, actual, "products")).toBe('products holds ["refusal","count","items"], without seqPath');
		expect(partialDifference({ count: 3 }, actual, "products")).toBe("products.count is 2, not 3");
		expect(partialDifference({ refusal: "*withdrawAnchor*" }, actual, "products")).toBe('products.refusal is "not permitted", which doesn\'t match "*withdrawAnchor*"');
		expect(partialDifference({ items: [{ id: "a" }, { id: "b" }] }, actual, "products")).toBe('products.items is [{"id":"a"}], not a list of 2 items');
		expect(partialDifference({ items: [{ id: "b" }] }, actual, "products")).toBe('products.items[0].id is "a", which doesn\'t match "b"');
	});
});
