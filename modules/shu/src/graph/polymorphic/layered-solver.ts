/**
 * Pin positions for the td/lr structural views: run the in-repo Sugiyama layout (@haibun/shu/graph/layered-layout) over
 * the visible model and return each node's CENTRE {x,y}. The 3D view pins nodes to these through the cohesion force, the
 * same way gantt/sequence pin to their lane targets; z stays the recorded-time depth (so the flow isn't tilted, yet the
 * option can still flatten it). Pure and headless — asserted without a scene.
 */
import { layeredLayout, type LayeredMetrics } from "../layered-layout.js";
import type { TGraph } from "../types.js";
import { collideRadius, chipTextHeight, LAYERED_RANK_GAP, LAYERED_SIBLING_GAP } from "./layout-forces.js";

export type LayeredNode = { id: string; label: string };
export type LayeredEdge = { from: string; to: string };
/** "TB" = top-down (layers advance down y), "LR" = left-right (layers advance along x). */
export type LayeredDirection = "TB" | "LR";

/** In a layered view the recorded-time depth is COMPRESSED to this fraction of the force-view depth (TIME_DEPTH_MAX = 700
 *  world units). The hierarchy is the point in td/lr, so the time becomes a subtle depth cue — NOT flattened to 0 (the
 *  option still does that) — that the ranks sit clear of. This lets the ranks pack at their natural Sugiyama spacing
 *  (short edges) instead of being spread far apart to clear a deep time cloud. Decoupled from the force depth: the
 *  force view widened (TIME_DEPTH_MAX 320→700) to separate dates, but td/lr compresses it to a shallow time cue (~77 world units). */
export const LAYERED_Z_FACTOR = 0.11;

/** A small floor for the rank-axis span so even a shallow DAG's ranks clear the compressed time-depth (TIME_DEPTH_MAX ×
 *  LAYERED_Z_FACTOR ≈ 77). The flow is stretched UP to this span only when naturally shorter — a taller DAG keeps its
 *  natural (short-edged) spacing, and a wide left-right flow is never blown up. */
export const LAYERED_MIN_FLOW_SPAN = 120;

export function layeredPositions(nodes: ReadonlyArray<LayeredNode>, edges: ReadonlyArray<LayeredEdge>, direction: LayeredDirection): Map<string, { x: number; y: number }> {
	const graph: TGraph = { nodes: nodes.map((n) => ({ id: n.id, label: n.label })), edges: edges.map((e) => ({ from: e.from, to: e.to })), direction };
	// Size nodes + gaps from the chip footprint (full w/h from the collideRadius/chipTextHeight half-extents) so the layout is in world units.
	const metrics: LayeredMetrics = {
		node: (_id, label) => ({ w: 2 * collideRadius({ name: label }), h: 2 * chipTextHeight({}) }),
		layerGap: LAYERED_RANK_GAP,
		siblingGap: LAYERED_SIBLING_GAP,
	};
	const laid = layeredLayout(graph, metrics);
	const out = new Map<string, { x: number; y: number }>();
	// LaidOutGraph boxes are top-left + w/h; the force target is the box centre.
	for (const [id, box] of laid.nodes) out.set(id, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
	return out;
}
