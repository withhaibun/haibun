/**
 * The failures of the run being read, as records rather than as marks.
 *
 * The bar marks the divisions a failure falls in, which says where to look; this reads the failures themselves, so a
 * reader lists them and opens one. It is the ordinary windowed query with a filter, capped: one read per counted type,
 * newest first, at the cap, so a run of any length costs the same to list.
 *
 * What counts as a failure is not decided here. Each counted type states the values its field takes, and a value whose
 * mark is a fault is a failure, which is the rule that colours a division: a mark and this list cannot disagree.
 */
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { MARK_COLOUR, eventMarkerStyle } from "../event-marker.js";
import { COUNTED } from "./run-marks.js";
import { rowOfRecord, type TRunRow } from "./run-window.js";
import type { TRunGraph } from "./run-graph.js";

/** How many failures a reader is shown: the newest of them, since a run can hold more failures than a reader reads. */
export const FAILURES_SHOWN = 50;

/** The values of a counted type whose mark is a fault: a step that failed, and a message reporting an error. */
const faultValues = (type: (typeof COUNTED)[number]): string[] => type.values.filter((value) => eventMarkerStyle(type.shapeOf(value)).color === MARK_COLOUR.fault);

/** The newest failures of a run, in the order the run reached them, newest first. */
export async function runFailures(graph: TRunGraph, { limit = FAILURES_SHOWN }: { limit?: number } = {}): Promise<TRunRow[]> {
	const perType = await Promise.all(
		COUNTED.map(async (type) => {
			// A graph that does not carry a type holds none of it, so asking for it would be asking a question with no answer.
			if (!graph.declares(type.label)) return [];
			const values = faultValues(type);
			if (values.length === 0) return [];
			const { vertices } = await graph.query(
				GraphQuerySchema.parse({
					label: type.label,
					filters: [{ predicate: type.groupBy, operator: "in", value: values[0], values }],
					sortBy: type.timeField,
					sortOrder: "desc",
					limit,
					skipCount: true,
				}),
			);
			return vertices.map((record) => rowOfRecord(type.label, record));
		}),
	);
	return perType
		.flat()
		.filter((row) => !Number.isNaN(row.at))
		.sort((a, b) => b.at - a.at)
		.slice(0, limit);
}
