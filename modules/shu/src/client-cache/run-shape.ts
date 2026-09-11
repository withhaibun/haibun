/**
 * What a run holds, counted as it grows: counts held per division, and only the stretch recorded since the last count.
 *
 * Counting a run's whole span again whenever the window is read is a read proportional to the run, made repeatedly. A
 * count of a stretch of the run that has passed cannot change, so it is counted once and held.
 *
 * A division is a fixed stretch of time rather than a share of the run's reach, which is what makes a held count still
 * true after the run grows: were divisions a share of the reach, every division would cover a different stretch after
 * every count and nothing could be held. The grid is as long as the run needs; when the run outgrows it the division
 * doubles and the counts either side of each new boundary are added together, so growth takes an addition rather than
 * a read. A mark carries the moment its division begins, so a rail places it by that moment whatever scale the rail
 * draws at, and the grid the counting uses is independent of the scale the marks are drawn on.
 */
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import type { TRunGraph } from "./run-graph.js";
import { runCounts, marksOf, type TRunMark } from "./run-marks.js";
import { runExtent } from "./run-window.js";

/** How many divisions a run is counted in, whatever its length. The count is what a rail of any run takes, so it is
 *  the same for a run of an hour and a run of a year. */
export const RUN_DIVISIONS = 200;

export type TRunShape = {
	/** One mark per division that holds anything, as the counts stand. */
	readonly marks: TRunMark[];
	/** The instant a division begins, which is the moment a mark of it carries. */
	beginningOf(division: number): number;
	/** Count what the run has recorded since the last count, up to the moment given. */
	update(to: number): Promise<void>;
};

/** Add the counts of each pair of divisions, which is what a division twice as long holds. */
function pairsMerged(counts: Record<string, number>[], divisions: number): Record<string, number>[] {
	const merged: Record<string, number>[] = [];
	for (let i = 0; i < divisions; i++) {
		const left = counts[i * 2] ?? {};
		const right = counts[i * 2 + 1] ?? {};
		const sum: Record<string, number> = { ...left };
		for (const [group, count] of Object.entries(right)) sum[group] = (sum[group] ?? 0) + count;
		merged[i] = sum;
	}
	return merged;
}

/** The marks of one run, counted as it grows. */
export function runShape(graph: TRunGraph, { divisions = RUN_DIVISIONS, minLevel = "info" }: { divisions?: number; minLevel?: THaibunLogLevel } = {}): TRunShape {
	let first: number | undefined;
	let divisionMs = 0;
	let countedThrough: number | undefined;
	let held: Record<string, number>[][] = [];
	let marks: TRunMark[] = [];
	const divisionOf = (at: number): number => Math.floor((at - (first as number)) / divisionMs);
	const beginningOf = (division: number): number => (first ?? 0) + division * divisionMs;
	return {
		get marks() {
			return marks;
		},
		beginningOf,
		update: async (to: number): Promise<void> => {
			if (countedThrough !== undefined && to <= countedThrough) return;
			if (first === undefined) {
				// The run's first record, read once: where a run begins does not change while it runs.
				const reach = await runExtent(graph, minLevel);
				if (reach.last === 0) return; // nothing recorded at this level, so there is nothing to count
				first = reach.first;
			}
			if (to < first) return;
			if (divisionMs === 0) divisionMs = Math.max(1, Math.ceil((to - first + 1) / divisions));
			while (divisionOf(to) >= divisions) {
				divisionMs *= 2;
				held = held.map((perType) => pairsMerged(perType, divisions));
			}
			// The division holding the last counted moment is counted again, since the run has written in it since; the
			// divisions before it are counted already and cannot change.
			const from = countedThrough === undefined ? 0 : divisionOf(countedThrough);
			const through = divisionOf(to);
			const counted = await runCounts(graph, {
				from: first + from * divisionMs,
				// One moment short of where the next division begins, so a record on a boundary is counted in the
				// division it belongs to rather than in the one being read.
				to: first + (through + 1) * divisionMs - 1,
				divisions: through - from + 1,
				minLevel,
			});
			counted.forEach((perType, type) => {
				held[type] ??= [];
				perType.forEach((counts, division) => (held[type][from + division] = counts));
			});
			countedThrough = to;
			marks = marksOf(held, { divisions, beginningOf });
		},
	};
}
