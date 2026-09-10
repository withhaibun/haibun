/**
 * Pure range math for the windowed event cache: each consumer registers the time span it wants, the cache holds the
 * reconciled union of all of them, fetches the gaps, and evicts the orphans. Half-open intervals [from, to) in epoch ms;
 * `to === Infinity` is the live edge (the only open interval). No I/O, no state, total functions over arrays of ranges.
 */
export type Range = { from: number; to: number };

/** Sort by `from`, collapse overlapping or touching ranges → a canonical disjoint, ascending set (empties dropped). */
export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
	const out: Range[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
		else out.push({ from: r.from, to: r.to });
	}
	return out;
}

/** a − b: the parts of `a` not covered by `b`. Powers gaps (wanted − held) and orphans (held − wanted). */
export function subtractRanges(a: Range[], b: Range[]): Range[] {
	const holes = mergeRanges(b);
	const out: Range[] = [];
	for (const r of mergeRanges(a)) {
		let cursor = r.from;
		for (const h of holes) {
			if (h.to <= cursor) continue; // hole before the cursor
			if (h.from >= r.to) break; // holes are sorted: the rest are past this range
			if (h.from > cursor) out.push({ from: cursor, to: h.from });
			cursor = h.to;
			if (cursor >= r.to) break;
		}
		if (cursor < r.to) out.push({ from: cursor, to: r.to });
	}
	return out;
}

/** The overlap of `a` and `b`, for windowed reads and live-event routing. */
export function intersectRanges(a: Range[], b: Range[]): Range[] {
	const out: Range[] = [];
	for (const x of mergeRanges(a))
		for (const y of mergeRanges(b)) {
			const from = Math.max(x.from, y.from);
			const to = Math.min(x.to, y.to);
			if (from < to) out.push({ from, to });
		}
	return mergeRanges(out);
}

/** Whether `t` falls in any range (half-open; the live edge `to === Infinity` includes the tail). */
export function rangeContains(ranges: Range[], t: number): boolean {
	return ranges.some((r) => t >= r.from && t < r.to);
}
