import { describe, expect, it } from "vitest";
import { BOUND, boundedItems, countingItems, limitedItems, listedProducts, matchingItems, orderedItems, type TList } from "./lists.js";
import { HYPERMEDIA } from "./protocol.js";
import { counted } from "./hypermedia.js";

const NO_ARGS = {};
const records: TList = {
	items: [
		{ name: "Ada", generatedAtTime: "2026-02-01T00:00:00.000Z", count: 3, _links: { read: "zed" } },
		{ name: "Bea", generatedAtTime: "2026-01-01T00:00:00.000Z", count: 10, tags: ["dance"] },
		{ name: "Cy", generatedAtTime: "2026-03-01T00:00:00.000Z" },
	],
	total: 3,
	saturated: true,
	time: "generatedAtTime",
};
const names = (listed: TList | { refused: string }) => ("refused" in listed ? listed.refused : listed.items.map(({ name }) => name));

describe("the list combinators", () => {
	it("match an item by any string it holds at any depth, without regard to case, apart from its hypermedia markers, and count what they kept", () => {
		expect(names(matchingItems("DANCE")(records, NO_ARGS))).toEqual(["Bea"]);
		expect(names(matchingItems("zed")(records, NO_ARGS)), "a marker's string isn't matched").toEqual([]);
		const matched = matchingItems("y")(records, NO_ARGS);
		expect("refused" in matched ? matched : { total: matched.total, saturated: matched.saturated }, "a floor stays a floor").toEqual({ total: 1, saturated: true });
	});

	it("count a list without its items, and limit it to its first items with the count of the whole", () => {
		expect(countingItems(records, NO_ARGS)).toEqual({ ...records, items: [] });
		expect(limitedItems(2)(records, NO_ARGS)).toEqual({ ...records, items: records.items.slice(0, 2) });
		expect(limitedItems(-1)(records, NO_ARGS)).toEqual({ refused: "can't limit a list to -1 items; state a count of 0 or more" });
	});

	it("order the items by a field's values, numbers by size and an item without the field last, and refuse a field the items don't hold", () => {
		expect(names(orderedItems("count")(records, NO_ARGS))).toEqual(["Ada", "Bea", "Cy"]);
		expect(names(orderedItems("name")({ ...records, items: [...records.items].reverse() }, NO_ARGS))).toEqual(["Ada", "Bea", "Cy"]);
		expect(names(orderedItems("colour")(records, NO_ARGS))).toBe("the list's items don't hold colour; order them by a field they hold: _links, count, generatedAtTime, name, tags");
	});

	it("bound a list of records at or after a time or before it, and refuse a list that doesn't state its items' time or an item without one", () => {
		const at = new Date("2026-02-01T00:00:00.000Z");
		expect(names(boundedItems(BOUND.since, at)(records, NO_ARGS))).toEqual(["Ada", "Cy"]);
		expect(names(boundedItems(BOUND.before, at)(records, NO_ARGS))).toEqual(["Bea"]);
		const { time: _time, ...untimed } = records;
		expect(names(boundedItems(BOUND.since, at)(untimed, NO_ARGS))).toContain("doesn't state a time for its items");
		expect(names(boundedItems(BOUND.since, at)({ ...records, items: [{ name: "Dee" }] }, NO_ARGS))).toContain("doesn't state its generatedAtTime as a time");
	});
});

describe("a list a step's products hold", () => {
	const products = { people: records.items, ...counted(records.items.length), [HYPERMEDIA.LIST]: { items: "people", time: "generatedAtTime" } };

	it("is replaced by the list a combinator made, with its counts, and keeps the products' other fields", () => {
		expect(listedProducts({ ...products, site: "here" }, limitedItems(1), NO_ARGS)).toEqual({
			products: { ...products, site: "here", people: records.items.slice(0, 1), total: 3, saturated: false },
		});
	});

	it("is refused where the products don't declare a list or don't hold the counted list they declare", () => {
		expect(listedProducts({ people: [] }, countingItems, NO_ARGS)).toEqual({
			refused: "the statement's products don't hold a list, since its step's products domain doesn't declare one; state a step that returns a list, such as show steps",
		});
		expect(listedProducts({ ...products, total: undefined }, countingItems, NO_ARGS)).toEqual({
			refused: "the statement's products don't hold the counted list people their domain declares; its step returns products its domain doesn't state",
		});
	});
});
