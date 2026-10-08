/**
 * The count a read returns.
 *
 * Counting every record of a type takes work that grows with the records, so a read counts up to a ceiling and stops.
 * A total alone doesn't distinguish a count that reached the end from a count that stopped at the ceiling. A reader
 * that receives only the total can present a partial count as exact. `saturated` distinguishes the two.
 */
import { describe, it, expect } from "vitest";
import { CountedSchema, counted, countedTo } from "./hypermedia.js";

describe("the count a read returns", () => {
	it("states a total that reached the end as exact", () => {
		expect(counted(37)).toEqual({ total: 37, saturated: false });
	});

	it("states a total that reached its ceiling as a lower bound, so a reader can show that more records exist", () => {
		expect(countedTo(1000, 1000)).toEqual({ total: 1000, saturated: true });
	});

	it("states a total under its ceiling as exact, since the count reached the last record", () => {
		expect(countedTo(42, 1000)).toEqual({ total: 42, saturated: false });
	});

	it("distinguishes an exact total of 1000 from a count that stopped at a ceiling of 1000", () => {
		expect(counted(1000).saturated).toBe(false);
		expect(countedTo(1000, 1000).saturated).toBe(true);
		expect(counted(1000).total, "the two hold the same total, so a reader reads `saturated` and not the total").toBe(countedTo(1000, 1000).total);
	});

	it("rejects a count that holds a total without `saturated`", () => {
		expect(() => CountedSchema.parse({ total: 12 })).toThrow();
		expect(() => CountedSchema.parse({ total: -1, saturated: false }), "a count below zero isn't a count").toThrow();
	});
});
