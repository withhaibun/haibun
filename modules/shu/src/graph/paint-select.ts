/**
 * Which paint view-types a graph carries, derived from the rels its nodes declare. A paint is offered alongside the
 * layout view-types (force / left-right / top-down) only when the data sits under the upper concepts that paint reads
 * — start-time rels ⇒ Gantt. The graph views (3D and overview) read this to populate their view-type control and to
 * render the chosen paint inline. As map/image/mesh paints land, they register here under their own upper concepts.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { isGanttable } from "./gantt-model.js";
import { getRelSync, getEdgeRelMap } from "../rels-cache.js";
import { edgeRel as coreEdgeRel } from "@haibun/core/lib/resources.js";

export type TPaintView = { id: string; label: string };

/** Resolve a stored predicate to its link relation: site metadata → edge map → core edge rel → the predicate itself. */
export const browserRelOf = (predicate: string, graph: string): string => getRelSync(graph, predicate) ?? getEdgeRelMap()[predicate] ?? coreEdgeRel(predicate) ?? predicate;

/** Paint view-types the data supports, offered in the graph's view-type control alongside the layout choices (force /
 *  left-right / top-down). Each is a layout the graph morphs into in place — start-time data ⇒ the gantt layout. */
export function availablePaints(quads: TQuad[], relOf: (predicate: string, graph: string) => string = browserRelOf): TPaintView[] {
	const paints: TPaintView[] = [];
	if (isGanttable(quads, relOf)) paints.push({ id: "gantt", label: "Gantt" });
	return paints;
}
