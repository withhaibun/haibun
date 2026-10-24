/**
 * The list a step's products hold. A domain whose products hold a list declares the array field that is its list, the field
 * of each item that states its time for a list of records, and the companion fields that narrow with the items (`listOf`).
 * Its products state how many items the list has and whether that count is a floor (`CountedFields`). A list combinator
 * applies a listing to the list of the step its statement ends with, and dispatch reads that step's declaration from its
 * products domain.
 */
import { z } from "zod";
import { CountedSchema } from "./hypermedia.js";
import { compareByOrder, satisfies } from "../steps/domains/quad-types.js";

/** An item of a list. */
export type TListItem = Record<string, unknown>;

/** Returns a companion field's value for the items a combinator kept, from the products that held the whole list. */
type TNarrowing = (items: readonly TListItem[], products: Readonly<Record<string, unknown>>) => unknown;

/** Which array field of a domain's products is its list, the field of each item that states its time, for a list of records,
 *  and how each companion field narrows to the items a combinator keeps. */
export type TListDeclaration = Readonly<{ items: string; time?: string; narrows?: Readonly<Partial<Record<string, TNarrowing>>> }>;

/** Declares the list a domain's products hold: the array field of the schema that is the list, and, where they apply, the
 *  field of each item that states its time and the companion fields that narrow with the items. */
export const listOf = <S extends z.ZodType<Record<string, unknown>>>(
	_schema: S,
	items: keyof z.infer<S> & string,
	more?: { time?: string; narrows?: Partial<Record<keyof z.infer<S> & string, TNarrowing>> },
): TListDeclaration => ({ items, ...more });

/** A list as a listing reads it: its items, how many there are, whether that count is a floor, and the field of each item
 *  that states its time, where its domain declares one. */
export type TList = { items: TListItem[]; total: number; saturated: boolean; time?: string };
/** What a combinator makes of a list: another list, or why it can't. */
export type TListing = (list: TList) => TList | { refused: string };

/** The order, offset and limit of a list that a read which takes them applies at its source, in place of the listings that
 *  state them, so the count of the whole list stays the source's count. */
export type TListQuery = { order?: { field: string; descending: boolean }; skip?: number; limit?: number };

/** One combinator's part of a statement's list: its listing, and the query a read applies in its place where it takes one. */
export type TListStage = { listing: TListing; query?: TListQuery };

const ItemsSchema = z.array(z.record(z.string(), z.unknown()));

/** Returns whether any of the texts contains the given text in a case-insensitive comparison. */
export function containsText(texts: Array<string | undefined>, text: string): boolean {
	const sought = text.toLowerCase();
	return texts.some((candidate) => candidate !== undefined && candidate.toLowerCase().includes(sought));
}

/** The text of each value an item holds at its top level, apart from its hypermedia markers, whose keys start with an underscore. */
const valueTexts = (item: TListItem): string[] =>
	Object.entries(item).flatMap(([key, value]) => (key.startsWith("_") || (typeof value !== "string" && typeof value !== "number") ? [] : [String(value)]));

/** The items that hold the text in one of their values, compared without regard to case. */
export const matchingItems =
	(text: string): TListing =>
	(list) => {
		const items = list.items.filter((item) => containsText(valueTexts(item), text));
		return { ...list, items, total: items.length };
	};

/** The count of the list without its items. */
export const countingItems: TListing = (list) => ({ ...list, items: [] });

/** The refusal of a count below 0 for what it counts. */
const negativeCount = (count: number, what: string): { refused: string } => ({ refused: `can't ${what} ${count} items; state a count of 0 or more` });

/** The first `count` items. The count of the whole list stays. */
export const limitedItems =
	(count: number): TListing =>
	(list) =>
		count < 0 ? negativeCount(count, "limit a list to") : { ...list, items: list.items.slice(0, count) };

/** The items after the first `count`. The count of the whole list stays. */
export const skippedItems =
	(count: number): TListing =>
	(list) =>
		count < 0 ? negativeCount(count, "skip") : { ...list, items: list.items.slice(count) };

/** The items in the order of a field's values, as a graph read orders them: numbers by size and any other value by its text,
 *  with an item that doesn't hold the field first, or last where the order descends. A field the items don't hold is refused,
 *  naming the fields they hold. */
export const orderedItems =
	(field: string, descending: boolean): TListing =>
	(list) => {
		const unheld = unheldField(list, field, "order by");
		if (unheld !== undefined) return unheld;
		return { ...list, items: [...list.items].sort(compareByOrder<TListItem>([{ key: field, order: descending ? "desc" : "asc" }], (key, item) => item[key])) };
	};

/** The items whose time satisfies the operator against the time, counted. A list whose domain doesn't declare a time is
 *  refused with what to state instead, and an item without a time isn't kept. */
const timedItems =
	(combinator: string, operator: "gte" | "lt", at: Date): TListing =>
	(list) => {
		const { time } = list;
		if (time === undefined)
			return { refused: `the list doesn't state a time for its items, so ${combinator} can't bound it; bound a list of records, such as the rows of a graph query` };
		const items = list.items.filter((item) => satisfies(item[time], { predicate: time, operator, value: at.toISOString() }));
		return { ...list, items, total: items.length };
	};

/** The records whose time is at or after the time. */
export const sinceItems = (at: Date): TListing => timedItems("since", "gte", at);
/** The records whose time is before the time. */
export const beforeItems = (at: Date): TListing => timedItems("before", "lt", at);

/** The bindings of an item a statement is proved for: the variable, which holds the item's id, or its text where it doesn't
 *  have one, and each value it holds as text or a number, as `variable/field`. */
export function itemBindings(variable: string, item: TListItem): Record<string, string | number> {
	const bindings: Record<string, string | number> = { [variable]: typeof item.id === "string" ? item.id : JSON.stringify(item) };
	for (const [field, value] of Object.entries(item))
		if (typeof value === "number") bindings[`${variable}/${field}`] = value;
		else if (typeof value === "string" || typeof value === "boolean") bindings[`${variable}/${field}`] = String(value);
	return bindings;
}

/** The refusal of a field the list's items don't hold, naming the fields they hold, where the list holds an item. */
const unheldField = (list: TList, field: string, combinator: string): { refused: string } | undefined =>
	list.items.length > 0 && !list.items.some((item) => field in item)
		? { refused: `the list's items don't hold ${field}; ${combinator} a field they hold: ${[...new Set(list.items.flatMap(Object.keys))].sort().join(", ")}` }
		: undefined;

/** The items whose value of a field holds the text, compared without regard to case, and counted. */
export const whoseItems =
	(field: string, text: string): TListing =>
	(list) => {
		const unheld = unheldField(list, field, "match");
		if (unheld !== undefined) return unheld;
		const items = list.items.filter((item) => item[field] !== undefined && item[field] !== null && containsText([String(item[field])], text));
		return { ...list, items, total: items.length };
	};

/** The first `count` items of each value of a field. The count of the whole list stays. */
export const perFieldItems =
	(count: number, field: string): TListing =>
	(list) => {
		if (count < 0) return negativeCount(count, "limit each value to");
		const unheld = unheldField(list, field, "limit by");
		if (unheld !== undefined) return unheld;
		const kept = new Map<string, number>();
		const items = list.items.filter((item) => {
			const value = String(item[field]);
			const held = kept.get(value);
			const now = held === undefined ? 1 : held + 1;
			kept.set(value, now);
			return now <= count;
		});
		return { ...list, items };
	};

/** The list unchanged where it holds exactly `count` items, and otherwise why it doesn't. A count that is a floor states a
 *  count of at least that many, so it isn't exact. */
export const exactlyItems =
	(count: number): TListing =>
	(list) => {
		if (list.saturated) return { refused: `the list holds at least ${list.total} items, a floor, so it can't hold exactly ${count}; state at least ${count}` };
		return list.total === count ? list : { refused: `the list holds ${list.total} items, not exactly ${count}` };
	};

/** The list unchanged where it holds at least `count` items, and otherwise how many it holds. */
export const atLeastItems =
	(count: number): TListing =>
	(list) =>
		list.total >= count ? list : { refused: `the list holds ${list.total} items, fewer than ${count}` };

/** The query that states `query` and then the stage's query. Returns undefined where the stage doesn't have a query, or
 *  where it orders a list whose order, offset or limit `query` already states. */
function joinedQuery(query: TListQuery, { query: next }: TListStage): TListQuery | undefined {
	if (next === undefined) return undefined;
	if (next.order !== undefined) return Object.keys(query).length === 0 ? { order: next.order } : undefined;
	if (next.skip !== undefined)
		return { ...query, skip: query.skip === undefined ? next.skip : query.skip + next.skip, ...(query.limit === undefined ? {} : { limit: Math.max(query.limit - next.skip, 0) }) };
	if (next.limit !== undefined) return { ...query, limit: query.limit === undefined ? next.limit : Math.min(query.limit, next.limit) };
	return undefined;
}

/** Each query a read may take in place of the first of `stages`, the longest first, with how many stages it states. */
export function listQueries(stages: readonly TListStage[]): { query: TListQuery; stated: number }[] {
	const queries: { query: TListQuery; stated: number }[] = [];
	let query: TListQuery = {};
	for (const stage of stages) {
		const joined = joinedQuery(query, stage);
		if (joined === undefined) break;
		query = joined;
		queries.unshift({ query, stated: queries.length + 1 });
	}
	return queries;
}

/** Returns products with the list the stages made of the list they hold, in order, and each companion field narrowed to the
 *  items kept, or why they can't: products that don't hold the counted list their domain declares, or a stage that refuses. */
export function listedProducts(
	products: Record<string, unknown>,
	declared: TListDeclaration,
	stages: readonly TListStage[],
): { products: Record<string, unknown> } | { refused: string } {
	const { items: field, time, narrows } = declared;
	const items = ItemsSchema.safeParse(products[field]);
	const counted = CountedSchema.safeParse(products);
	if (!items.success || !counted.success)
		return { refused: `the statement's products don't hold the counted list ${field} their domain declares; its step returns products its domain doesn't state` };
	let list: TList | { refused: string } = { items: items.data, ...counted.data, ...(time === undefined ? {} : { time }) };
	for (const { listing } of stages) {
		if ("refused" in list) break;
		list = listing(list);
	}
	if ("refused" in list) return list;
	const kept = list.items;
	const companions = (narrows === undefined ? [] : Object.entries(narrows)).flatMap(([companion, narrow]) => (narrow === undefined ? [] : [[companion, narrow(kept, products)]]));
	return { products: { ...products, ...Object.fromEntries(companions), [field]: kept, total: list.total, saturated: list.saturated } };
}
