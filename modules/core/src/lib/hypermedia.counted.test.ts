/**
 * What a read answers when it counts.
 *
 * Counting every record of a type is work that grows with the records, so a read counts to a ceiling and stops. A
 * reader told only the number cannot tell a total that reached the end from one that stopped, and states a number
 * nothing counted. These state the two apart.
 */
import { describe, it, expect } from "vitest";
import { CountedSchema, counted, countedTo } from "./hypermedia.js";

describe("a count a read answers with", () => {
	it("states a total that reached the end as exact", () => {
		expect(counted(37)).toEqual({ total: 37, saturated: false });
	});

	it("states a total that reached its ceiling as a floor, so a reader says there are more", () => {
		expect(countedTo(1000, 1000)).toEqual({ total: 1000, saturated: true });
	});

	it("states a total under its ceiling as exact, since counting stopped where the records did", () => {
		expect(countedTo(42, 1000)).toEqual({ total: 42, saturated: false });
	});

	it("tells an exact thousand from a thousand it stopped at, which one number cannot", () => {
		expect(counted(1000).saturated).toBe(false);
		expect(countedTo(1000, 1000).saturated).toBe(true);
		expect(counted(1000).total, "and the two state the same number, so a reader reads the marker rather than the total").toBe(countedTo(1000, 1000).total);
	});

	it("refuses a count that says how many without saying whether it reached the end", () => {
		expect(() => CountedSchema.parse({ total: 12 })).toThrow();
		expect(() => CountedSchema.parse({ total: -1, saturated: false }), "a count of fewer than none is no count").toThrow();
	});
});
