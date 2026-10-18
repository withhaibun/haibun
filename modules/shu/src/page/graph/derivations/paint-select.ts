/**
 * Which paint view-types a graph carries, derived from the rels its nodes declare. A paint is offered alongside the
 * layout view-types (force / left-right / top-down) only when the data is under the upper concepts that paint reads
 * start-time rels ⇒ Gantt. The graph views (3D and overview) read this to populate their view-type control and to
 * render the chosen paint inline. As map/image/mesh paints land, they register here under their own upper concepts.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { isGanttable } from "./gantt-model.js";
import type { TCatalog } from "../../derivations/catalog.js";
import { edgeRel as coreEdgeRel } from "@haibun/core/lib/domains/resources.js";

type TPaintView = { id: string; label: string };

/** Resolve a stored predicate to its link relation, in order: the relation the catalog declares for the graph's field, the
 *  catalog's edge relation, the core edge relation, and the predicate itself, which is its own relation where the
 *  catalog and the core rels leave it undeclared. */
export function browserRelOf(catalog: TCatalog, predicate: string, graph: string): string {
	const fieldRel = catalog.fieldRels[graph]?.[predicate];
	if (fieldRel !== undefined) return fieldRel;
	const edge = catalog.edgeRels[predicate];
	if (edge !== undefined) return edge;
	const core = coreEdgeRel(predicate);
	return core === undefined ? predicate : core;
}

/** Paint view-types the data supports, offered in the graph's view-type control alongside the layout choices (force /
 *  left-right / top-down). Each is a layout the graph morphs into in place, start-time data ⇒ the gantt layout. */
export function availablePaints(quads: TQuad[], relOf: (predicate: string, graph: string) => string): TPaintView[] {
	const paints: TPaintView[] = [];
	if (isGanttable(quads, relOf)) paints.push({ id: "gantt", label: "Gantt" });
	return paints;
}
