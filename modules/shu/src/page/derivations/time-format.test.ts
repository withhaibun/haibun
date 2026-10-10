import { describe, expect, it } from "vitest";
import { formatCount, formatInstant, isDateValue } from "./time-format.js";

const TORONTO = { locale: "en-CA", timeZone: "America/Toronto" };
const MONTREAL = { locale: "fr-CA", timeZone: "America/Toronto" };
/** A Wednesday, at noon in Toronto. */
const NOW = new Date("2026-03-04T17:00:00Z");

describe("an instant", () => {
	it("reads as the reader's day and its time on the reader's day, in the reader's zone", () => {
		expect(formatInstant("2026-03-04T14:30:00Z", NOW, TORONTO)).toBe("today, 09:30 a.m.");
		expect(formatInstant("2026-03-05T03:30:00Z", NOW, TORONTO), "the next UTC day is the same day in Toronto").toMatch(/^today, /);
	});

	it("reads as its weekday in the reader's week, its month and day in the reader's year, and adds its year before it", () => {
		expect(formatInstant("2026-03-02T15:00:00Z", NOW, TORONTO)).toMatch(/^Monday /);
		expect(formatInstant("2026-03-01T15:00:00Z", NOW, TORONTO), "a week starts on Monday").toMatch(/^Mar\.? 1 /);
		expect(formatInstant("2025-12-25T15:00:00Z", NOW, TORONTO)).toMatch(/^Dec\.? 25, 2025 /);
	});

	it("formats in fr-CA in a named zone", () => {
		expect(formatInstant("2026-03-02T15:00:00Z", NOW, MONTREAL)).toBe("lundi 10 h 00");
		expect(formatInstant("2026-01-15T15:00:00Z", NOW, MONTREAL)).toBe("15 janv. 10 h 00");
		expect(formatInstant("2026-03-04T14:30:00Z", NOW, MONTREAL)).toBe("aujourd’hui, 09 h 30");
	});

	it("returns a text that doesn't state an instant as it is", () => {
		expect(formatInstant("not a date", NOW, TORONTO)).toBe("not a date");
		expect(isDateValue("2026-03-04T14:30")).toBe(true);
		expect(isDateValue("Wed, 4 Mar 2026 14:30:00 +0000")).toBe(true);
		expect(isDateValue("12345")).toBe(false);
	});
});

describe("a count", () => {
	it("is grouped below a million, and compact with one fraction digit from a million", () => {
		expect(formatCount(42, "en-US")).toBe("42");
		expect(formatCount(12_345, "en-US")).toBe("12,345");
		expect(formatCount(1_200_000, "en-US")).toBe("1.2M");
		expect(formatCount(15_000_000, "en-US")).toBe("15M");
		expect(formatCount(9_950_000, "en-US")).toBe("10M");
		expect(formatCount(9_940_000, "en-US")).toBe("9.9M");
		expect(formatCount(12_345, "fr-CA")).toBe("12\u00a0345");
	});
});
