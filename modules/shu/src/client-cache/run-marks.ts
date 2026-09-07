/**
 * The shape of a run, by division: what a reader is shown of a run of any length.
 *
 * A division is marked rather than its records listed, so the answer's size is the divisions asked for and reading a
 * decade costs what reading an hour costs. The store counts; nothing here reads a row.
 *
 * Each type a run records is counted by the field that says how its records turned out, and the divisions are merged,
 * so a step that failed and a message reporting an error both mark their division as a failure.
 */
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import type { TDensityQuery } from "@haibun/core/lib/quad-types.js";
import { bucketMarkerStyle, type TEventMarkerStyle } from "../event-marker.js";
import type { TRunGraph } from "./run-graph.js";

/** A division of the run and the mark it earns: where it falls, and what it looks like. */
export type TRunMark = TEventMarkerStyle & { division: number };

/** What a type of record is counted by, and the event shape that says how one of its groups turned out. A group's
 *  appearance is `eventMarkerStyle`'s to decide, so a division and a row can never disagree about a failure. */
const COUNTED = [
	{ label: SEQ_PATH_LABEL, timeField: SEQ_PATH_FIELD.generatedAtTime, groupBy: SEQ_PATH_FIELD.actionStatus, shapeOf: (status: string) => ({ kind: "lifecycle", type: "step", stage: "end", status }) },
	{ label: LOG_MESSAGE_LABEL, timeField: LOG_MESSAGE_FIELD.generatedAtTime, groupBy: LOG_MESSAGE_FIELD.level, shapeOf: (level: string) => ({ kind: "log", level }) },
] as const;

/** The levels at or above the one a reader asked for, which is what a level filter means. */
const atOrAbove = (minLevel: THaibunLogLevel): THaibunLogLevel[] => HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel)) as THaibunLogLevel[];

/** The run's shape over a span, one mark per division that holds anything, in the order the divisions run. */
export async function runMarks(graph: TRunGraph, { from, to, divisions, minLevel = "info" }: { from: number; to: number; divisions: number; minLevel?: THaibunLogLevel }): Promise<TRunMark[]> {
	const levels = atOrAbove(minLevel);
	const counted = await Promise.all(
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
			return buckets.map((counts: Record<string, number>) => Object.entries(counts).map(([group, count]) => ({ event: type.shapeOf(group), count })));
		}),
	);
	const marks: TRunMark[] = [];
	for (let division = 0; division < divisions; division++) {
		const held = counted.flatMap((perType) => perType[division] ?? []);
		const style = bucketMarkerStyle(held);
		if (style) marks.push({ ...style, division });
	}
	return marks;
}
