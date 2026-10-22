import { describe, expect, it } from "vitest";
import { Conditions } from "./conditions.js";

describe("conditions that repeat", () => {
	it("starts a condition at its first occurrence, counts each repeat, and ends it with what it held", () => {
		const conditions = new Conditions(10);
		expect(conditions.occurs("poll/Review", "Command failed", 1)).toBe(true);
		expect(conditions.occurs("poll/Review", "Command failed", 2)).toBe(false);
		expect(conditions.occurs("poll/Review", "Connection reset", 3)).toBe(false);
		expect(conditions.ends("poll/Review")).toEqual({ first: "Command failed", latest: "Connection reset", since: 1, occurrences: 3 });
		expect(conditions.ends("poll/Review"), "an ended condition doesn't end twice").toBeUndefined();
		expect(conditions.occurs("poll/Review", "Command failed", 4), "a later occurrence starts it again").toBe(true);
	});

	it("holds at most its bound, dropping the condition held longest, whose next occurrence starts it again", () => {
		const conditions = new Conditions(2);
		conditions.occurs("a", "x", 1);
		conditions.occurs("b", "x", 2);
		expect(conditions.occurs("c", "x", 3)).toBe(true);
		expect(conditions.size).toBe(2);
		expect(conditions.occurs("b", "x", 4), "b holds still").toBe(false);
		expect(conditions.occurs("a", "x", 5), "a was dropped, so it starts again").toBe(true);
	});

	it("refuses a bound that doesn't hold a condition", () => {
		expect(() => new Conditions(0)).toThrow("holds at least one");
	});
});
