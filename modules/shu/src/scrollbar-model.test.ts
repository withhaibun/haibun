import { describe, it, expect } from "vitest";
import { thumbHeightPx, thumbTopPx, firstAtPointer, markerTopPx, clusterMarkers, formatCount, pressTarget, MARK_SNAP_PX, type TScrollMarker } from "./scrollbar-model.js";

const RAIL = 400;
/** A representative thumb height: geometry below takes it as a pixel input, whatever produced it. */
const THUMB = 40;

describe("thumb size and position", () => {
	it("sizes the thumb to the share of the column on screen", () => {
		expect(thumbHeightPx(25 / 100, RAIL)).toBe(100); // a quarter of 400
	});

	it("never shrinks below the minimum, so it stays grabbable at millions of rows", () => {
		expect(thumbHeightPx(40 / 5_000_000, RAIL)).toBe(16); // rounds to 0 → clamped to minThumbPx
	});

	it("puts the thumb at the top at offset 0 and the bottom at the last window", () => {
		expect(thumbTopPx(1000, { first: 0, visible: 50 }, RAIL, THUMB)).toBe(0);
		const heightPx = THUMB;
		expect(thumbTopPx(1000, { first: 950, visible: 50 }, RAIL, heightPx)).toBe(RAIL - heightPx);
	});

	it("degrades to a full-height thumb when everything fits", () => {
		expect(thumbHeightPx(10 / 10, RAIL)).toBe(RAIL);
	});

	it("takes the thumb height as an input, so a caller holding it steady holds the marks steady too", () => {
		// Marks are inset by half the thumb. Sizing from the viewport share (not the rendered row count) is what keeps that
		// height steady while a reader scrolls; here it is simply given, and two different heights place a mark differently.
		const total = 300;
		expect(markerTopPx(200, total, RAIL, 40)).not.toBe(markerTopPx(200, total, RAIL, 16));
		expect(thumbTopPx(total, { first: 0, visible: 30 }, RAIL, 40)).toBe(0);
	});
});

describe("firstAtPointer is the inverse of thumb positioning", () => {
	it("maps the rail top to the first window and the rail bottom to the last", () => {
		expect(firstAtPointer(1000, 50, 0, RAIL, THUMB)).toBe(0);
		expect(firstAtPointer(1000, 50, RAIL, RAIL, THUMB)).toBe(950); // total - visible
	});

	it("round-trips a mid drag back to a thumb near the pointer", () => {
		const total = 1_000_000;
		const visible = 30;
		const first = firstAtPointer(total, visible, RAIL / 2, RAIL, THUMB);
		const heightPx = THUMB;
		const topPx = thumbTopPx(total, { first, visible }, RAIL, heightPx);
		expect(Math.abs(topPx + heightPx / 2 - RAIL / 2)).toBeLessThanOrEqual(heightPx);
	});

	it("clamps a pointer past the ends to a valid window", () => {
		expect(firstAtPointer(1000, 50, -50, RAIL, THUMB)).toBe(0);
		expect(firstAtPointer(1000, 50, RAIL + 50, RAIL, THUMB)).toBe(950);
	});
});

describe("markerTopPx (spread, inset into the thumb's reach)", () => {
	it("spreads marks across the thumb's reachable range: first near the top inset, last near the bottom inset", () => {
		const total = 1000;
		const heightPx = THUMB;
		expect(markerTopPx(0, total, RAIL, THUMB)).toBe(Math.round(heightPx / 2));
		expect(markerTopPx(total - 1, total, RAIL, THUMB)).toBe(RAIL - Math.round(heightPx / 2));
	});
	it("does not pile the last rows at the bottom: distinct tail indices map to distinct, increasing pixels (the bug the windowed scale caused)", () => {
		const total = 200; // a small total where a fat thumb once made the windowed scale clamp the tail
		const a = markerTopPx(190, total, RAIL, THUMB);
		const b = markerTopPx(195, total, RAIL, THUMB);
		const c = markerTopPx(199, total, RAIL, THUMB);
		expect(a).toBeLessThan(b);
		expect(b).toBeLessThan(c);
	});
	it("keeps every mark within the rail, monotonic non-decreasing, even in a million-row column", () => {
		const total = 5_000_000;
		let prev = -1;
		for (let i = 0; i < total; i += 50_000) {
			const px = markerTopPx(i, total, RAIL, THUMB);
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
		const clustered = clusterMarkers(markers, 1_000_000, RAIL, THUMB);
		expect(clustered).toHaveLength(2);
		expect(clustered[0].count).toBe(3);
		expect(clustered[1].count).toBe(1);
	});

	it("keeps well-separated annotations distinct", () => {
		const clustered = clusterMarkers([mk(0, "a"), mk(500, "b"), mk(999, "c")], 1000, RAIL, THUMB);
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
		expect(firstAtPointer(total, visible, 0, RAIL, THUMB)).toBe(0);
		expect(firstAtPointer(total, visible, RAIL, RAIL, THUMB)).toBe(total - visible);
		let prev = -1;
		for (let px = 0; px <= RAIL; px++) {
			const f = firstAtPointer(total, visible, px, RAIL, THUMB);
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
		const clustered = clusterMarkers(markers, 1_000_000, RAIL, THUMB);
		expect(clustered).toHaveLength(1);
		expect(clustered[0].count).toBe(3);
		expect(clustered[0].id).toBe("a"); // the topmost (lowest index)
		expect(clustered[0].icon).toBe("📝");
	});

	it("degenerate guards: empty column, zero-height rail, single-row set", () => {
		expect(thumbTopPx(0, { first: 0, visible: 0 }, RAIL, RAIL)).toBe(0);
		expect(thumbHeightPx(10 / 100, 0)).toBe(0); // zero-height rail
		expect(thumbTopPx(100, { first: 0, visible: 10 }, 0, 0)).toBe(0);
		expect(firstAtPointer(0, 0, 200, RAIL, THUMB)).toBe(0);
		expect(markerTopPx(5, 1, RAIL, 16)).toBeLessThanOrEqual(RAIL); // single-row column: no crash, stays on the rail
	});
});

describe("what a press on the rail means", () => {
	// Two answers, because a rail carries two things: marks, which sit at their row among all the rows, and positions,
	// which pick a window among the windows there are. A press on a mark means that mark; a press on the track means the
	// place pressed. The marks do not take their own presses — drawn across the middle of a narrow rail, a mark that did
	// would swallow most attempts to point at a position.
	const RAIL = 200;
	const THUMB = 20;
	const at = (index: number) => markerTopPx(index, 100, RAIL, THUMB);

	it("means the mark, when the press lands on one", () => {
		const marks = [{ index: 40, topPx: at(40) }];
		expect(pressTarget(at(40), marks, 100, 10, RAIL, THUMB)).toBe(40);
	});

	it("still means the mark just inside the reach, and the place pressed just outside it", () => {
		const marks = [{ index: 40, topPx: at(40) }];
		expect(pressTarget(at(40) + MARK_SNAP_PX, marks, 100, 10, RAIL, THUMB), "within reach").toBe(40);
		const beyond = pressTarget(at(40) + MARK_SNAP_PX + 1, marks, 100, 10, RAIL, THUMB);
		expect(beyond, "past it, the press means where it landed").toBe(firstAtPointer(100, 10, at(40) + MARK_SNAP_PX + 1, RAIL, THUMB));
	});

	it("means the nearer mark when two are within reach", () => {
		const marks = [
			{ index: 40, topPx: at(40) },
			{ index: 43, topPx: at(40) + 5 },
		];
		expect(pressTarget(at(40) + 4, marks, 100, 10, RAIL, THUMB)).toBe(43);
	});

	it("means the place pressed when there are no marks at all", () => {
		const px = RAIL / 2;
		expect(pressTarget(px, [], 100, 10, RAIL, THUMB)).toBe(firstAtPointer(100, 10, px, RAIL, THUMB));
	});

	it("does not read a mark's row as a window, which would land somewhere else entirely", () => {
		// The two scales differ by what is on screen: the same pixel is a different answer to each question, so a press
		// on a mark must give the mark's ROW rather than the window that pixel would scroll to.
		const marks = [{ index: 50, topPx: at(50) }];
		expect(pressTarget(at(50), marks, 100, 40, RAIL, THUMB)).toBe(50);
		expect(firstAtPointer(100, 40, at(50), RAIL, THUMB), "which the place-pressed answer would have given").not.toBe(50);
	});
});
