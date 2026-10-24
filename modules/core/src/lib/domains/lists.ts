/**
 * The list a step's products hold, and the combinators that make something of it. A domain whose products hold a list
 * declares the array field that is its list and, for a list of records, the field of each item that states its time; its
 * products state how many items the list has and whether that count is a floor (`CountedFields`). Dispatch marks a step's
 * products with its domain's declaration, so a combinator that runs a statement reads the list of whatever step the
 * statement ends with, and returns the products with the list it made in place of the list it read.
 */
import { z } from "zod";
import { CountedSchema } from "./hypermedia.js";
import { HYPERMEDIA } from "./protocol.js";

/** Which array field of a domain's products is its list, and the field of each item that states its time, for a list of records. */
export const ListDeclarationSchema = z.object({ items: z.string(), time: z.string().optional() }).strict();
export type TListDeclaration = z.infer<typeof ListDeclarationSchema>;

/** A list as a combinator reads it: its items, how many there are, whether that count is a floor, and the field of each item
 *  that states its time, where its domain declares one. */
export type TList = { items: Record<string, unknown>[]; total: number; saturated: boolean; time?: string };
/** What a combinator makes of a list, from the arguments of its line: another list, or why it can't. */
export type TListing = (list: TList, args: Readonly<Record<string, unknown>>) => TList | { refused: string };

const ItemsSchema = z.array(z.record(z.string(), z.unknown()));

/** Returns whether any of the texts contains the given text in a case-insensitive comparison. */
export function containsText(texts: Array<string | undefined>, text: string): boolean {
	const sought = text.toLowerCase();
	return texts.some((candidate) => candidate !== undefined && candidate.toLowerCase().includes(sought));
}

/** Every string a value holds, at any depth, apart from its hypermedia markers, whose keys start with an underscore. */
function stringsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringsOf);
	if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, held]) => (key.startsWith("_") ? [] : stringsOf(held)));
	return [];
}

/** The items whose strings hold the text, compared without regard to case. */
export const matchingItems =
	(text: string): TListing =>
	(list) => {
		const items = list.items.filter((item) => containsText(stringsOf(item), text));
		return { ...list, items, total: items.length };
	};

/** The count of the list without its items. */
export const countingItems: TListing = (list) => ({ ...list, items: [] });

/** The first `count` items. The count of the whole list stays. */
export const limitedItems =
	(count: number): TListing =>
	(list) =>
		count < 0 ? { refused: `can't limit a list to ${count} items; state a count of 0 or more` } : { ...list, items: list.items.slice(0, count) };

/** Compares two values of a field: numbers by size, and any other value by its text. A value the item doesn't hold comes last. */
function compareValues(a: unknown, b: unknown): number {
	if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
	return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

/** The items in the order of a field's values. A field the items don't hold is refused, naming the fields they hold. */
export const orderedItems =
	(field: string): TListing =>
	(list) => {
		if (list.items.length > 0 && !list.items.some((item) => field in item))
			return { refused: `the list's items don't hold ${field}; order them by a field they hold: ${[...new Set(list.items.flatMap(Object.keys))].sort().join(", ")}` };
		return { ...list, items: [...list.items].sort((a, b) => compareValues(a[field], b[field])) };
	};

/** Where a bound puts the items it keeps: at or after its time, or before it. */
export const BOUND = { since: "since", before: "before" } as const;
type TBound = (typeof BOUND)[keyof typeof BOUND];

/** The items whose time is at or after the time (since), or before it (before). A list whose domain doesn't declare a time,
 *  or an item without a time, is refused with what to state instead. */
export const boundedItems =
	(bound: TBound, at: Date): TListing =>
	(list) => {
		const { time } = list;
		if (time === undefined)
			return { refused: `the list doesn't state a time for its items, so ${bound} can't bound it; bound a list of records, such as the rows of a graph query` };
		const timed = list.items.map((item) => ({ item, ms: typeof item[time] === "string" || typeof item[time] === "number" ? new Date(item[time]).getTime() : Number.NaN }));
		const untimed = timed.find(({ ms }) => Number.isNaN(ms));
		if (untimed !== undefined)
			return { refused: `an item of the list doesn't state its ${time} as a time: ${JSON.stringify(untimed.item)}; bound a list whose every item states it` };
		const items = timed.filter(({ ms }) => (bound === BOUND.since ? ms >= at.getTime() : ms < at.getTime())).map(({ item }) => item);
		return { ...list, items, total: items.length };
	};

/** Returns products with the list a combinator made of their list in place of it, or why it can't: products that don't
 *  hold a declared list, or a list the combinator refuses. */
export function listedProducts(
	products: Record<string, unknown> | undefined,
	listing: TListing,
	args: Readonly<Record<string, unknown>>,
): { products: Record<string, unknown> } | { refused: string } {
	const declared = ListDeclarationSchema.safeParse(products?.[HYPERMEDIA.LIST]);
	if (products === undefined || !declared.success)
		return { refused: "the statement's products don't hold a list, since its step's products domain doesn't declare one; state a step that returns a list, such as show steps" };
	const { items: field, time } = declared.data;
	const items = ItemsSchema.safeParse(products[field]);
	const counted = CountedSchema.safeParse(products);
	if (!items.success || !counted.success)
		return { refused: `the statement's products don't hold the counted list ${field} their domain declares; its step returns products its domain doesn't state` };
	const listed = listing({ items: items.data, ...counted.data, ...(time === undefined ? {} : { time }) }, args);
	if ("refused" in listed) return listed;
	return { products: { ...products, [field]: listed.items, total: listed.total, saturated: listed.saturated } };
}
