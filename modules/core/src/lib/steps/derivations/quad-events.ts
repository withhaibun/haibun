/**
 * The quads a batch of events announces, and whether a batch changes what a view of one type shows.
 */
import { z } from "zod";
import { QuadSchema, type TQuad } from "../domains/quad-types.js";

/** A quad observation event: a json artifact whose json holds the quad a store wrote. */
const QuadObservationSchema = z.object({
	kind: z.literal("artifact"),
	artifactType: z.literal("json"),
	json: z.object({ quadObservation: z.object({ ...QuadSchema.shape, subject: z.string().min(1), predicate: z.string().min(1), namedGraph: z.string().min(1) }) }),
});

/** The quads a batch of events announces, in the order of the events. An event that isn't a quad observation doesn't
 *  announce a quad. */
export function extractQuadsFromEvents(events: Record<string, unknown>[]): TQuad[] {
	return events.flatMap((event) => {
		const observed = QuadObservationSchema.safeParse(event);
		return observed.success ? [observed.data.json.quadObservation] : [];
	});
}

/**
 * Whether a batch of events carries a data change relevant to a view scoped to `label`: the single relevance test a
 * live view applies before re-deriving itself from the graph. True when the batch yields at least one quad and, if a
 * `label` is given, at least one quad in that named graph; without a `label` any quad is relevant (an unscoped view).
 * A caller that only refreshes when scoped (e.g. label-specific filter values) guards the no-label case itself.
 */
export function eventsAffectLabel(events: Record<string, unknown>[], label?: string): boolean {
	const quads = extractQuadsFromEvents(events);
	if (quads.length === 0) return false;
	return !label || quads.some((q) => q.namedGraph === label);
}
