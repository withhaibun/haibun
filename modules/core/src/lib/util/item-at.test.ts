import { describe, expect, it } from "vitest";
import { itemAt, valueAt } from "./item-at.js";

describe("itemAt", () => {
	it("returns the item at an index within the list", () => expect(itemAt(["a", "b"], 1)).toBe("b"));
	it("throws for an index outside the list", () => expect(() => itemAt(["a"], 1)).toThrow("index 1 is outside a list of 1"));
});

describe("valueAt", () => {
	it("returns the value the map holds for a key, including an undefined value", () => {
		expect(valueAt(new Map([["a", 1]]), "a", "the counts")).toBe(1);
		expect(valueAt(new Map([["a", undefined]]), "a", "the counts")).toBeUndefined();
	});
	it("throws for a key the map lacks, and names what the map holds", () => expect(() => valueAt(new Map([["a", 1]]), "b", "the counts")).toThrow("the counts: the map lacks b"));
});
