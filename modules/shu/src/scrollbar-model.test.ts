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

describe("markerTopPx (aligned with the thumb)", () => {
	it("sits at the thumb's centre when the marked row is the first visible one, so clicking the mark lands the thumb on it", () => {
		const total = 1000, visible = 30, index = 400;
		const { topPx, heightPx } = thumbGeometry(total, { first: index, visible }, RAIL);
		expect(markerTopPx(index, total, RAIL, visible)).toBe(topPx + Math.round(heightPx / 2));
	});
	it("places the first row near the top and the last near the bottom, always within the rail", () => {
		const total = 1000, visible = 30;
		const first = markerTopPx(0, total, RAIL, visible);
		const last = markerTopPx(total - 1, total, RAIL, visible);
		expect(first).toBeGreaterThanOrEqual(0);
		expect(first).toBeLessThan(RAIL / 2);
		expect(last).toBeGreaterThan(RAIL / 2);
		expect(last).toBeLessThanOrEqual(RAIL);
	});
	it("is monotonic non-decreasing across indices, even in a million-row column", () => {
		const total = 5_000_000, visible = 40;
		let prev = -1;
		for (let i = 0; i < total; i += 50_000) {
			const px = markerTopPx(i, total, RAIL, visible);
			expect(px).toBeGreaterThanOrEqual(prev);
			expect(px).toBeLessThanOrEqual(RAIL);
			prev = px;
		}
	});
});

describe("clusterMarkers", () => {
	const mk = (index: number, id: string): TScrollMarker => ({ index, id, icon: "📝", color: "#000" });

	it("merges annotations that fall within a few pixels into one mark carrying a count", () => {
		// three rows adjacent in a huge column collapse to one pixel slot
		const markers = [mk(10, "a"), mk(11, "b"), mk(12, "c"), mk(900_000, "d")];
		const clustered = clusterMarkers(markers, 1_000_000, RAIL, 30);
		expect(clustered).toHaveLength(2);
		expect(clustered[0].count).toBe(3);
		expect(clustered[1].count).toBe(1);
	});

	it("keeps well-separated annotations distinct", () => {
		const clustered = clusterMarkers([mk(0, "a"), mk(500, "b"), mk(999, "c")], 1000, RAIL, 30);
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
	it("does not print a '10.0M' band: the >=10 branch sees the rounded value (B4)", () => {
		expect(formatCount(9_990_000)).toBe("10M");
		expect(formatCount(9_950_000)).toBe("10M");
		expect(formatCount(9_940_000)).toBe("9.9M");
		expect(formatCount(10_000_000)).toBe("10M");
	});
});

describe("hardening (adversarial review)", () => {
	it("firstAtPointer is monotonic and reaches both ends across the whole rail at millions", () => {
		const total = 5_000_000;
		const visible = 30;
		expect(firstAtPointer(total, visible, 0, RAIL)).toBe(0);
		expect(firstAtPointer(total, visible, RAIL, RAIL)).toBe(total - visible);
		let prev = -1;
		for (let px = 0; px <= RAIL; px++) {
			const f = firstAtPointer(total, visible, px, RAIL);
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThanOrEqual(total - visible);
			expect(f).toBeGreaterThanOrEqual(prev); // never steps backwards
			prev = f;
		}
	});

	it("a merged cluster keeps the topmost marker's identity and the total count, from unsorted input", () => {
		const markers: TScrollMarker[] = [
			{ index: 12, id: "c", icon: "🔴", color: "#f00" },
			{ index: 10, id: "a", icon: "📝", color: "#00f" },
			{ index: 11, id: "b", icon: "⚠️", color: "#fa0" },
		];
		const clustered = clusterMarkers(markers, 1_000_000, RAIL, 30);
		expect(clustered).toHaveLength(1);
		expect(clustered[0].count).toBe(3);
		expect(clustered[0].id).toBe("a"); // the topmost (lowest index)
		expect(clustered[0].icon).toBe("📝");
	});

	it("degenerate guards: empty column, zero-height rail, single-row set", () => {
		expect(thumbGeometry(0, { first: 0, visible: 0 }, RAIL)).toEqual({ topPx: 0, heightPx: RAIL });
		expect(thumbGeometry(100, { first: 0, visible: 10 }, 0)).toEqual({ topPx: 0, heightPx: 0 });
		expect(firstAtPointer(0, 0, 200, RAIL)).toBe(0);
		expect(markerTopPx(5, 1, RAIL, 1)).toBeLessThanOrEqual(RAIL); // single-row column: no crash, stays on the rail
	});
});
