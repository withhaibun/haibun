// A rail carries the whole run, however long it ran: the window a reader holds is where they pick a moment, and what
// actuality did outside it still has a place at the ends.
import { describe, it, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import { FOCUS_SHARE, momentAt, railAt, type TActualityFocus, type TActualitySpan } from "./rail.js";

const HOUR = 3600_000;
const YEAR = 365 * 24 * HOUR;

describe("where a moment of a run sits on a rail", () => {
	it("spreads a run its window covers evenly, so a short run is not drawn as a long one", () => {
		const span: TActualitySpan = { first: 0, last: 1000 };
		const focus: TActualityFocus = { at: 500, from: 0, to: 1000 };
		expect(railAt(0, span, focus)).toBe(0);
		expect(railAt(500, span, focus)).toBeCloseTo(0.5, 6);
		expect(railAt(1000, span, focus)).toBe(1);
	});

	it("gives the window the middle share, so a reader picks a moment in what they are reading", () => {
		const span: TActualitySpan = { first: 0, last: YEAR };
		const focus: TActualityFocus = { at: YEAR - HOUR, from: YEAR - 2 * HOUR, to: YEAR };
		const held = railAt(YEAR, span, focus) - railAt(YEAR - 2 * HOUR, span, focus);
		expect(held).toBeCloseTo(FOCUS_SHARE, 2);
	});

	it("keeps a moment a year back on the rail, further out than one an hour back", () => {
		const span: TActualitySpan = { first: 0, last: YEAR };
		const focus: TActualityFocus = { at: YEAR, from: YEAR - HOUR, to: YEAR };
		const aYearBack = railAt(HOUR, span, focus);
		const anHourBack = railAt(YEAR - 2 * HOUR, span, focus);
		expect(aYearBack).toBeGreaterThan(0);
		expect(aYearBack).toBeLessThan(anHourBack);
	});

	it("runs one way from the run's first record to its last", () => {
		const span: TActualitySpan = { first: 0, last: YEAR };
		const focus: TActualityFocus = { at: YEAR / 2, from: YEAR / 2 - HOUR, to: YEAR / 2 + HOUR };
		const at = Array.from({ length: 40 }, (_, i) => railAt((i * YEAR) / 39, span, focus));
		for (let i = 1; i < at.length; i++) expect(itemAt(at, i), `moment ${i} sits after moment ${i - 1}`).toBeGreaterThanOrEqual(itemAt(at, i - 1));
		expect(at[0]).toBe(0);
		expect(at[at.length - 1]).toBe(1);
	});

	it("answers with the moment a place on the rail names, which is what a press asks actuality for", () => {
		const span: TActualitySpan = { first: 0, last: YEAR };
		const focus: TActualityFocus = { at: YEAR - HOUR, from: YEAR - 2 * HOUR, to: YEAR };
		for (const moment of [0, YEAR / 4, YEAR - 3 * HOUR, YEAR - HOUR, YEAR]) {
			expect(momentAt(railAt(moment, span, focus), span, focus), `the rail names the moment it was given for ${moment}`).toBeCloseTo(moment, -3);
		}
	});

	it("answers the first record for a run of one instant, since the run doesn't have another place to be", () => {
		const span: TActualitySpan = { first: 5, last: 5 };
		const focus: TActualityFocus = { at: 5, from: 5, to: 5 };
		expect(railAt(5, span, focus)).toBe(0);
		expect(momentAt(0.5, span, focus)).toBe(5);
	});
});
