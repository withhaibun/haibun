import { describe, expect, it } from "vitest";
import {
	atLeastItems,
	exactlyItems,
	itemBindings,
	perFieldItems,
	whoseItems,
	whoseQuery,
	fieldComparisonSchema,
	type TFieldComparison,
	beforeItems,
	countingItems,
	limitedItems,
	listOf,
	listQueries,
	listedProducts,
	matchingItems,
	orderedItems,
	sinceItems,
	skippedItems,
	type TList,
	type TListStage,
} from "./lists.js";
import { counted } from "./hypermedia.js";
import { z } from "zod";

const records: TList = {
	items: [
		{ name: "Ada", generatedAtTime: "2026-02-01T00:00:00.000Z", count: 3, _links: { read: "zed" } },
		{ name: "Bea", generatedAtTime: "2026-01-01T00:00:00.000Z", count: 10, tags: ["dance"], role: "dancer" },
		{ name: "Cy", generatedAtTime: "2026-03-01T00:00:00.000Z" },
	],
	total: 3,
	saturated: true,
	time: "generatedAtTime",
};
const names = (listed: TList | { refused: string }) => ("refused" in listed ? listed.refused : listed.items.map(({ name }) => name));

describe("the list combinators", () => {
	it("match an item by a value it holds at its top level, without regard to case, apart from its hypermedia markers, and count what they kept", () => {
		expect(names(matchingItems("DANCE")(records))).toEqual(["Bea"]);
		expect(names(matchingItems("zed")(records)), "a marker's string isn't matched").toEqual([]);
		expect(names(matchingItems("10")(records)), "a number is matched by its text").toEqual(["Bea"]);
		const matched = matchingItems("y")(records);
		expect("refused" in matched ? matched : { total: matched.total, saturated: matched.saturated }, "a floor stays a floor").toEqual({ total: 1, saturated: true });
	});

	it("count a list without its items, and limit it to its first items or skip them with the count of the whole", () => {
		expect(countingItems(records)).toEqual({ ...records, items: [] });
		expect(limitedItems(2)(records)).toEqual({ ...records, items: records.items.slice(0, 2) });
		expect(skippedItems(2)(records)).toEqual({ ...records, items: records.items.slice(2) });
		expect(limitedItems(-1)(records)).toEqual({ refused: "can't limit a list to -1 items; state a count of 0 or more" });
		expect(skippedItems(-1)(records)).toEqual({ refused: "can't skip -1 items; state a count of 0 or more" });
	});

	it("order the items by a field's values as a graph read does, numbers by size and an item without the field first, and refuse a field the items don't hold", () => {
		expect(names(orderedItems("count", false)(records))).toEqual(["Cy", "Ada", "Bea"]);
		expect(names(orderedItems("count", true)(records))).toEqual(["Bea", "Ada", "Cy"]);
		expect(names(orderedItems("name", false)({ ...records, items: [...records.items].reverse() }))).toEqual(["Ada", "Bea", "Cy"]);
		expect(names(orderedItems("colour", false)(records))).toBe("the list's items don't hold colour; order by a field they hold: _links, count, generatedAtTime, name, role, tags");
	});

	it("bound a list of records at or after a time or before it, leave out an item without one, and refuse a list that doesn't state its items' time", () => {
		const at = new Date("2026-02-01T00:00:00.000Z");
		expect(names(sinceItems(at)(records))).toEqual(["Ada", "Cy"]);
		expect(names(beforeItems(at)(records))).toEqual(["Bea"]);
		const { time: _time, ...untimed } = records;
		expect(names(sinceItems(at)(untimed))).toContain("doesn't state a time for its items, so since can't bound it");
		expect(names(sinceItems(at)({ ...records, items: [{ name: "Dee" }] }))).toEqual([]);
	});
});

describe("the combinators that keep items by a field's value", () => {
	const comparing = (written: string): TFieldComparison => fieldComparisonSchema.parse(written);

	it("keep the items whose value of a field holds a text, without regard to case, count them, and refuse a field the items don't hold", () => {
		expect(names(whoseItems("role", comparing("matches DANC"))(records))).toEqual(["Bea"]);
		expect(names(whoseItems("name", comparing('matches "a"'))(records)), "a value is read as text").toEqual(["Ada", "Bea"]);
		const kept = whoseItems("role", comparing("matches dancer"))(records);
		expect("refused" in kept ? kept : kept.total).toBe(1);
		expect(names(whoseItems("colour", comparing("matches red"))(records))).toContain("the list's items don't hold colour; compare a field they hold");
	});

	it("keep the items whose value of a field equals a value, or is more or less than it, numbers by size and other values by their text", () => {
		expect(names(whoseItems("name", comparing('is "Bea"'))(records))).toEqual(["Bea"]);
		expect(names(whoseItems("name", comparing("is bea"))(records)), "equality regards case").toEqual([]);
		expect(names(whoseItems("count", comparing("is more than 3"))(records)), "10 is more than 3 by size, not by text").toEqual(["Bea"]);
		expect(names(whoseItems("count", comparing("is less than 10"))(records)), "an item without the field isn't kept").toEqual(["Ada"]);
		expect(names(whoseItems("generatedAtTime", comparing('is less than "2026-02-01"'))(records)), "a time compares by its text").toEqual(["Bea"]);
	});

	it("read a comparison as a line states it, and refuse one that doesn't start with a comparison", () => {
		expect(comparing("is more than 3")).toEqual({ operator: "gt", value: "3" });
		expect(comparing('is "is less than"'), "is begins the longer comparisons, which a value may hold").toEqual({ operator: "eq", value: "is less than" });
		expect(fieldComparisonSchema.safeParse("holds 3").error?.issues[0]?.message).toBe(
			'"holds 3" isn\'t a comparison: state matches, is more than, is less than, is, then the value',
		);
	});

	it("keep the first items of each value of a field, with the count of the whole list", () => {
		const people: TList = { ...records, items: [...records.items, { name: "Di", role: "dancer" }, { name: "Ed", role: "dancer" }] };
		expect(names(perFieldItems(1, "role")(people)), "an item without the field holds a value of its own").toEqual(["Ada", "Bea"]);
		expect(names(perFieldItems(2, "role")(people))).toEqual(["Ada", "Bea", "Cy", "Di"]);
		const limited = perFieldItems(1, "role")(people);
		expect("refused" in limited ? limited : limited.total).toBe(3);
		expect(perFieldItems(-1, "role")(people)).toEqual({ refused: "can't limit each value to -1 items; state a count of 0 or more" });
	});
});

describe("the combinators that state how many items a list holds", () => {
	const exact = { ...records, saturated: false };
	it("return the list where it holds exactly the count, and refuse another count or a floor", () => {
		expect(exactlyItems(3)(exact)).toEqual(exact);
		expect(exactlyItems(2)(exact)).toEqual({ refused: "the list holds 3 items, not exactly 2" });
		expect(exactlyItems(3)(records)).toEqual({ refused: "the list holds at least 3 items, a floor, so it can't hold exactly 3; state at least 3" });
	});

	it("return the list where it holds at least the count, a floor among them, and refuse fewer", () => {
		expect(atLeastItems(3)(records)).toEqual(records);
		expect(atLeastItems(1)(exact)).toEqual(exact);
		expect(atLeastItems(4)(exact)).toEqual({ refused: "the list holds 3 items, fewer than 4" });
	});
});

describe("an item a statement is proved for", () => {
	it("binds the variable to its id, or its text without one, and each value it holds as text or a number", () => {
		expect(itemBindings("person", { id: "p-1", name: "Ada", count: 3, member: true, tags: ["dance"] })).toEqual({
			person: "p-1",
			"person/id": "p-1",
			"person/name": "Ada",
			"person/count": 3,
			"person/member": "true",
		});
		expect(itemBindings("person", { name: "Bea" })).toEqual({ person: '{"name":"Bea"}', "person/name": "Bea" });
	});
});

describe("the query a read takes in place of a statement's listings", () => {
	const stage = (query?: TListStage["query"]): TListStage => ({ listing: countingItems, ...(query === undefined ? {} : { query }) });
	const order = { field: "name", descending: true };

	it("states each run of an order, an offset and a limit from the first stage, the longest first", () => {
		expect(listQueries([stage({ order }), stage({ skip: 2 }), stage({ limit: 5 }), stage({ skip: 1 })])).toEqual([
			{ query: { order, skip: 3, limit: 4 }, stated: 4 },
			{ query: { order, skip: 2, limit: 5 }, stated: 3 },
			{ query: { order, skip: 2 }, stated: 2 },
			{ query: { order }, stated: 1 },
		]);
		expect(listQueries([stage({ limit: 5 }), stage({ limit: 3 })])[0], "the least limit holds").toEqual({ query: { limit: 3 }, stated: 2 });
	});

	it("stops at a stage without a query and at an order that follows another part", () => {
		expect(listQueries([stage(), stage({ limit: 5 })])).toEqual([]);
		expect(listQueries([stage({ limit: 5 }), stage({ order })])).toEqual([{ query: { limit: 5 }, stated: 1 }]);
	});

	it("join the filters of whose before the list is paged, and leave a comparison it makes without regard to case to the listing", () => {
		const inbox = { predicate: "folder", operator: "eq", value: "INBOX" } as const;
		const big = { predicate: "size", operator: "gt", value: "1000" } as const;
		expect(listQueries([stage({ filters: [inbox] }), stage({ filters: [big] }), stage({ limit: 5 })])[0]).toEqual({ query: { filters: [inbox, big], limit: 5 }, stated: 3 });
		expect(listQueries([stage({ limit: 5 }), stage({ filters: [big] })]), "a filter after a page narrows the page").toEqual([{ query: { limit: 5 }, stated: 1 }]);
		expect(whoseQuery("folder", { operator: "eq", value: "INBOX" })).toEqual({ filters: [inbox] });
		expect(whoseQuery("subject", { operator: "contains", value: "Invoice" })).toEqual({});
	});
});

describe("a list a step's products hold", () => {
	const PeopleSchema = z.object({ people: z.array(z.record(z.string(), z.unknown())), roles: z.array(z.string()), total: z.number(), saturated: z.boolean() });
	const declared = listOf(PeopleSchema, "people", {
		time: "generatedAtTime",
		narrows: { roles: (items) => items.flatMap(({ role }) => (typeof role === "string" ? [role] : [])) },
	});
	const products = { people: records.items, roles: ["dancer", "singer"], ...counted(records.items.length) };

	it("is replaced by the list each stage made in turn, with its counts, its companions narrowed and the products' other fields kept", () => {
		expect(listedProducts({ ...products, site: "here" }, declared, [{ listing: matchingItems("a") }, { listing: limitedItems(1) }])).toEqual({
			products: { site: "here", people: records.items.slice(0, 1), roles: [], total: 2, saturated: false },
		});
		expect(listedProducts(products, declared, [{ listing: countingItems }]), "a count doesn't hold a companion's values").toEqual({
			products: { people: [], roles: [], total: 3, saturated: false },
		});
	});

	it("is refused where the products don't hold the counted list they declare, and with the refusal of a stage", () => {
		expect(listedProducts({ ...products, total: undefined }, declared, [{ listing: countingItems }])).toEqual({
			refused: "the statement's products don't hold the counted list people their domain declares; its step returns products its domain doesn't state",
		});
		expect(listedProducts(products, declared, [{ listing: limitedItems(-2) }])).toEqual({ refused: "can't limit a list to -2 items; state a count of 0 or more" });
	});
});
