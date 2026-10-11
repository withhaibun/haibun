/**
 * The marks of a run: one mark per division of a span that holds something, as each counted type's records turned out.
 * Each type a run records is counted by the field that states how its records turned out, and the divisions are merged,
 * so a step that failed and a message reporting an error both mark their division as a failure.
 */
import { HAIBUN_LOG_LEVELS } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL, SEQ_PATH_STATUS } from "@haibun/core/lib/resources.js";
import { bucketMarkerStyle, type TEventMarkerStyle } from "../../derivations/event-marker.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** A mark of actuality: what it looks like, and the moment it marks. A rail places it by that moment, so the same marks
 *  draw on a rail of any scale. */
export type TRunMark = TEventMarkerStyle & { at: number };

/** What a type of record is counted by, the values that field takes, and the event shape that shows how one of its
 *  groups turned out. `eventMarkerStyle` states a group's appearance, so a division and a row can never disagree about
 *  a failure, and a reading of the failures themselves reads these types for the values whose mark is a fault. */
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

/** The mark each division takes from what it holds, over every type counted, at the moment its division begins: one
 *  mark per division that holds anything, in the order actuality reached them. The caller states where a division
 *  begins, since it is the caller that laid the grid out. */
export function marksOf(counts: Record<string, number>[][], { divisions, beginningOf }: { divisions: number; beginningOf: (division: number) => number }): TRunMark[] {
	const marks: TRunMark[] = [];
	for (let division = 0; division < divisions; division++) {
		const held = counts.flatMap((perType, type) => Object.entries(itemAt(perType, division)).map(([group, count]) => ({ event: itemAt(COUNTED, type).shapeOf(group), count })));
		const style = bucketMarkerStyle(held);
		if (style) marks.push({ ...style, at: beginningOf(division) });
	}
	return marks;
}
