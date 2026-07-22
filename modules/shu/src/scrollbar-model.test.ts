import { describe, it, expect } from "vitest";
import { thumbGeometry, firstAtPointer, markerTopPx, clusterMarkers, formatCount, type TScrollMarker } from "./scrollbar-model.js";

const RAIL = 400;

describe("thumbGeometry", () => {
	it("sizes the thumb to the visible fraction", () => {
		const { heightPx } = thumbGeometry(100, { first: 0, visible: 25 }, RAIL);
		expect(heightPx).toBe(100); // 25/100 * 400
	});

	it("never shrinks below the minimum, so it stays grabbable at millions of rows", () => {
		const { heightPx } = thumbGeometry(5_000_000, { first: 0, visible: 40 }, RAIL);
		expect(heightPx).toBe(16); // 40/5e6 rounds to 0 → clamped to minThumbPx
	});

	it("puts the thumb at the top at offset 0 and the bottom at the last window", () => {
		expect(thumbGeometry(1000, { first: 0, visible: 50 }, RAIL).topPx).toBe(0);
		const bottom = thumbGeometry(1000, { first: 950, visible: 50 }, RAIL);
		expect(bottom.topPx).toBe(RAIL - bottom.heightPx);
	});

	it("degrades to a full-height thumb when everything fits", () => {
		expect(thumbGeometry(10, { first: 0, visible: 10 }, RAIL).heightPx).toBe(RAIL);
	});
});

describe("firstAtPointer is the inverse of thumb positioning", () => {
	it("maps the rail top to the first window and the rail bottom to the last", () => {
		expect(firstAtPointer(1000, 50, 0, RAIL)).toBe(0);
		expect(firstAtPointer(1000, 50, RAIL, RAIL)).toBe(950); // total - visible
	});

	it("round-trips a mid drag back to a thumb near the pointer", () => {
		const total = 1_000_000;
		const visible = 30;
		const first = firstAtPointer(total, visible, RAIL / 2, RAIL);
		const { topPx, heightPx } = thumbGeometry(total, { first, visible }, RAIL);
		expect(Math.abs(topPx + heightPx / 2 - RAIL / 2)).toBeLessThanOrEqual(heightPx);
	});

	it("clamps a pointer past the ends to a valid window", () => {
		expect(firstAtPointer(1000, 50, -50, RAIL)).toBe(0);
		expect(firstAtPointer(1000, 50, RAIL + 50, RAIL)).toBe(950);
	});
});

describe("markerTopPx", () => {
	it("places the first row at the top and the last at the bottom of the rail", () => {
		expect(markerTopPx(0, 1000, RAIL)).toBe(0);
		expect(markerTopPx(999, 1000, RAIL)).toBe(RAIL);
	});
	it("places a mid-set annotation proportionally, even in a million-row column", () => {
		expect(markerTopPx(500_000, 1_000_001, RAIL)).toBe(RAIL / 2);
	});
});

describe("clusterMarkers", () => {
	const mk = (index: number, id: string): TScrollMarker => ({ index, id, icon: "📝", color: "#000" });

	it("merges annotations that fall within a few pixels into one mark carrying a count", () => {
		// three rows adjacent in a huge column collapse to one pixel slot
		const markers = [mk(10, "a"), mk(11, "b"), mk(12, "c"), mk(900_000, "d")];
		const clustered = clusterMarkers(markers, 1_000_000, RAIL, 10);
		expect(clustered).toHaveLength(2);
		expect(clustered[0].count).toBe(3);
		expect(clustered[1].count).toBe(1);
	});

	it("keeps well-separated annotations distinct", () => {
		const clustered = clusterMarkers([mk(0, "a"), mk(500, "b"), mk(999, "c")], 1000, RAIL, 10);
		expect(clustered.map((c) => c.count)).toEqual([1, 1, 1]);
	});
});

describe("formatCount glyphs", () => {
	it("shows small counts plainly", () => expect(formatCount(42)).toBe("42"));
	it("thousands-separates up to a million", () => expect(formatCount(12_345)).toBe("12,345"));
	it("compacts millions so they fit the rail", () => {
		expect(formatCount(1_200_000)).toBe("1.2M");
		expect(formatCount(15_000_000)).toBe("15M");
	});
});
