/**
 * What an actuality holds, counted as it grows: counts held per division, and only the stretch recorded since the last count.
 *
 * Counting an actuality's whole span again whenever the window is read is a read proportional to its length, made repeatedly.
 * A count of a stretch of the actuality that has passed cannot change, so it is counted once and held.
 *
 * A division is a fixed stretch of time rather than a share of actuality's reach, which is what makes a held count still
 * true after actuality grows: were divisions a share of the reach, every division would cover a different stretch after
 * every count and a count couldn't be held. The grid is as long as actuality needs; when actuality outgrows it the division
 * doubles and the counts either side of each new boundary are added together, so growth takes an addition rather than
 * a read. A mark carries the moment its division begins, so a rail places it by that moment at any scale, and the grid
 * the counting uses is independent of the scale that draws the marks.
 */
import type { THaibunLogLevel } from "@haibun/core/lib/domains/protocol.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import type { TPageDensity } from "../../pipelines/read-records.js";
import { anyOf, hasValue } from "@haibun/core/lib/records/domains/class-expression.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TActualityGraph } from "../ports.js";
import { COUNTED, marksOf, type TActualityMark } from "../derivations/actuality-marks.js";
import { levelsFrom } from "../derivations/actuality-rows.js";
import { actualityExtent } from "./actuality-window.js";

/** How many divisions an actuality is counted in, whatever its length. The count is what a rail of any actuality takes, so it is
 *  the same for an actuality of an hour and an actuality of a year. */
export const ACTUALITY_DIVISIONS = 200;

export type TActualityShape = {
	/** One mark per division that holds anything, as the counts stand. */
	readonly marks: TActualityMark[];
	/** The instant a division begins, which is the moment a mark of it carries. */
	beginningOf(division: number): number;
	/** Count what actuality has recorded since the last count, up to the moment given. */
	update(to: number): Promise<void>;
};

/** Returns the counts of divisions added together, by group. */
function summed(counts: Record<string, number>[]): Record<string, number> {
	const sum: Record<string, number> = {};
	for (const one of counts)
		for (const [group, count] of Object.entries(one)) {
			const was = sum[group];
			sum[group] = was === undefined ? count : was + count;
		}
	return sum;
}

/** Add the counts of each pair of divisions, which is what a division twice as long holds. The divisions past the last
 *  pair are empty. */
const pairsMerged = (counts: Record<string, number>[], divisions: number): Record<string, number>[] =>
	Array.from({ length: divisions }, (_, i) => summed(counts.slice(i * 2, i * 2 + 2)));

/** Empty counts, one per division. */
const uncounted = (divisions: number): Record<string, number>[] => Array.from({ length: divisions }, () => ({}));

/** How many records of each counted type fall in each division of a span, by how each turned out: one array per type,
 *  in the order the types are counted, each holding one set of counts per division. What a division holds and what it
 *  looks like are two rules, so this function doesn't choose a mark. */
export function actualityCounts(
	graph: TActualityGraph,
	{ from, to, divisions, minLevel }: { from: number; to: number; divisions: number; minLevel: THaibunLogLevel },
): Promise<Record<string, number>[][]> {
	const levels = levelsFrom(minLevel);
	return Promise.all(
		COUNTED.map(async (type) => {
			// A graph that does not carry a type doesn't hold a record of it, so its divisions are empty.
			if (!graph.declares(type.label)) return uncounted(divisions);
			const query: TPageDensity = {
				label: type.label,
				timeField: type.timeField,
				groupBy: type.groupBy,
				from: new Date(from).toISOString(),
				to: new Date(to).toISOString(),
				buckets: divisions,
				expression: anyOf(levels.map((level) => hasValue(SEQ_PATH_FIELD.level, level))),
			};
			const { buckets } = await graph.density(query);
			return buckets;
		}),
	);
}

/** The instant an actuality's first record was written at `minLevel`, or undefined while it hasn't written one. */
async function beginningOfActuality(graph: TActualityGraph, minLevel: THaibunLogLevel): Promise<number | undefined> {
	const reached = await actualityExtent(graph, minLevel);
	return reached.last === 0 ? undefined : reached.first;
}

/** The marks of one actuality at `minLevel`, counted in `divisions` as it grows. */
export function actualityShape(graph: TActualityGraph, { minLevel, divisions }: { minLevel: THaibunLogLevel; divisions: number }): TActualityShape {
	let first: number | undefined;
	let divisionMs = 0;
	let countedThrough: number | undefined;
	let held: Record<string, number>[][] = COUNTED.map(() => uncounted(divisions));
	let marks: TActualityMark[] = [];
	const divisionOf = (at: number): number => Math.floor((at - (first as number)) / divisionMs);
	const beginningOf = (division: number): number => {
		if (first === undefined) throw new Error(`division ${division} of an actuality doesn't begin before its first record at ${minLevel}`);
		return first + division * divisionMs;
	};
	const count = async (to: number): Promise<void> => {
		if (countedThrough !== undefined && to <= countedThrough) return;
		if (first === undefined) {
			// Its first record, read once: where an actuality begins does not change while it runs.
			first = await beginningOfActuality(graph, minLevel);
			if (first === undefined) return; // actuality hasn't recorded at this level, so it doesn't have a record to count
		}
		if (to < first) return;
		if (divisionMs === 0) divisionMs = Math.max(1, Math.ceil((to - first + 1) / divisions));
		while (divisionOf(to) >= divisions) {
			divisionMs *= 2;
			held = held.map((perType) => pairsMerged(perType, divisions));
		}
		// The division holding the last counted moment is counted again, since actuality has written in it since; the
		// divisions before it are counted already and cannot change.
		const from = countedThrough === undefined ? 0 : divisionOf(countedThrough);
		const through = divisionOf(to);
		const counted = await actualityCounts(graph, {
			from: first + from * divisionMs,
			// One moment short of where the next division begins, so a record on a boundary is counted in its own
			// division rather than in the one being read.
			to: first + (through + 1) * divisionMs - 1,
			divisions: through - from + 1,
			minLevel,
		});
		counted.forEach((perType, type) => {
			const heldOfType = itemAt(held, type);
			perType.forEach((counts, division) => (heldOfType[from + division] = counts));
		});
		countedThrough = to;
		marks = marksOf(held, { divisions, beginningOf });
	};
	// A count checks what is counted, awaits the store, then writes what it counted. Counts are taken in turn, so a count
	// requested while another awaits the store checks what that one wrote. The caller of a count that failed receives its
	// failure, and the count after it is taken.
	let counting: Promise<void> = Promise.resolve();
	return {
		get marks() {
			return marks;
		},
		beginningOf,
		update: (to: number): Promise<void> => {
			const taken = counting.then(() => count(to));
			// The caller receives a count's failure, and the next count runs once this one settles either way.
			counting = Promise.allSettled([taken]).then(() => undefined);
			return taken;
		},
	};
}
