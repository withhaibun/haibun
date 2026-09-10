/**
 * What a run holds, counted rather than read: one mark per division of a span that holds something.
 *
 * A division is counted, so a rail carrying a year costs what its divisions cost rather than what the run did. The
 * store counts; nothing here reads a row. Each type a run records is counted by the field that says how its records
 * turned out, and the divisions are merged, so a step that failed and a message reporting an error both mark their
 * division as a failure.
 */
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "@haibun/core/lib/resources.js";
import type { TDensityQuery } from "@haibun/core/lib/quad-types.js";
import { bucketMarkerStyle, type TEventMarkerStyle } from "../event-marker.js";
import type { TRunGraph } from "./run-graph.js";

/** A mark of the run: what it looks like, and the moment it stands for. A rail places it by that moment, so the same
 *  marks draw on a rail of any scale. */
export type TRunMark = TEventMarkerStyle & { at: number };

/** What a type of record is counted by, the values that field takes, and the event shape that says how one of its
 *  groups turned out. A group's appearance is `eventMarkerStyle`'s to decide, so a division and a row can never
 *  disagree about a failure, and a reading that asks for the failures themselves asks these types for the values whose
 *  mark is a fault. */
export const COUNTED = [
	{
		label: SEQ_PATH_LABEL,
		timeField: SEQ_PATH_FIELD.generatedAtTime,
		groupBy: SEQ_PATH_FIELD.actionStatus,
		values: Object.values(SEQ_PATH_STATUS) as readonly string[],
		shapeOf: (status: string) => ({ kind: "lifecycle", type: "step", stage: "end", status }),
	},
	{
		label: LOG_MESSAGE_LABEL,
		timeField: LOG_MESSAGE_FIELD.generatedAtTime,
		groupBy: LOG_MESSAGE_FIELD.level,
		values: HAIBUN_LOG_LEVELS as readonly string[],
		shapeOf: (level: string) => ({ kind: "log", level }),
	},
] as const;

/** The levels at or above the one a reader asked for, which is what a level filter means. */
const atOrAbove = (minLevel: THaibunLogLevel): THaibunLogLevel[] => HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel)) as THaibunLogLevel[];

/** How many records of each counted type fall in each division of a span, by how each turned out: one array per type,
 *  in the order the types are counted, each holding one set of counts per division. What a division holds and what it
 *  looks like are two rules, so nothing is marked here. */
export function runCounts(
	graph: TRunGraph,
	{ from, to, divisions, minLevel = "info" }: { from: number; to: number; divisions: number; minLevel?: THaibunLogLevel },
): Promise<Record<string, number>[][]> {
	const levels = atOrAbove(minLevel);
	return Promise.all(
		COUNTED.map(async (type) => {
			// A graph that does not carry a type holds none of it, so asking for it would be asking a question with no answer.
			if (!graph.declares(type.label)) return [];
			const query: TDensityQuery = {
				label: type.label,
				timeField: type.timeField,
				groupBy: type.groupBy,
				from: new Date(from).toISOString(),
				to: new Date(to).toISOString(),
				buckets: divisions,
				filters: [{ predicate: "level", operator: "in", value: levels[0], values: levels }],
			};
			const { buckets } = await graph.density(query);
			return buckets;
		}),
	);
}

/** The mark each division takes from what it holds, over every type counted, at the moment its division begins: one
 *  mark per division that holds anything, in the order the run reached them. The caller states where a division
 *  begins, since it is the caller that laid the grid out. */
export function marksOf(counts: Record<string, number>[][], { divisions, beginningOf }: { divisions: number; beginningOf: (division: number) => number }): TRunMark[] {
	const marks: TRunMark[] = [];
	for (let division = 0; division < divisions; division++) {
		const held = counts.flatMap((perType, type) => Object.entries(perType[division] ?? {}).map(([group, count]) => ({ event: COUNTED[type].shapeOf(group), count })));
		const style = bucketMarkerStyle(held);
		if (style) marks.push({ ...style, at: beginningOf(division) });
	}
	return marks;
}
