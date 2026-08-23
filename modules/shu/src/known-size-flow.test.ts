// The size-aware flow layout: rows the source knows render nothing take no room and never count toward the average, so a
// column with many empty rows caches a steady estimate of what it has not measured.
import { describe, it, expect } from "vitest";
import { KnownSizeFlowLayout } from "./known-size-flow.js";

const sizes = (entries: Array<[number, number]>) => Object.fromEntries(entries.map(([i, h]) => [i, { width: 100, height: h }]));

function layout(empty: Set<number>): KnownSizeFlowLayout {
	const l = new KnownSizeFlowLayout(() => undefined, {});
	l.rowSize = (i) => (empty.has(i) ? 0 : undefined);
	return l;
}

describe("KnownSizeFlowLayout", () => {
	it("a known-empty row is 0 without measuring; the average is over rows with content only", () => {
		const l = layout(new Set([1, 3]));
		l.updateItemSizes(sizes([[0, 20], [1, 0], [2, 40], [3, 0]]));
		expect(l._getSize(1)).toBe(0);
		expect(l._getSize(3)).toBe(0);
		expect(l._getAverageSize(), "20 and 40, not dragged down by the two zeros").toBe(30);
	});
	it("a stretch not yet seen is estimated as content rows at the average in the share seen to have content", () => {
		const l = layout(new Set([1, 3]));
		l.updateItemSizes(sizes([[0, 20], [1, 0], [2, 40], [3, 0]]));
		expect(l.expectedRowSize(), "half the rows seen have content, at 30 each").toBe(15);
		expect(l._estimatePosition(10), "before anything is placed: ten rows at the expected size").toBe(150);
	});
	it("a re-measured row replaces its earlier size in the average", () => {
		const l = layout(new Set());
		l.updateItemSizes(sizes([[0, 20], [1, 40]]));
		l.updateItemSizes(sizes([[1, 60]]));
		expect(l._getAverageSize()).toBe(40);
	});
	it("without a rowSize response it is the flow layout: every row measured, the plain average", () => {
		const l = new KnownSizeFlowLayout(() => undefined, {});
		l.updateItemSizes(sizes([[0, 10], [1, 0]]));
		expect(l._getAverageSize()).toBe(5);
		expect(l.expectedRowSize()).toBe(5);
	});
});
