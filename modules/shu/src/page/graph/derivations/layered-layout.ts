/**
 * Layered (Sugiyama-lite) layout for a directed graph: assign each node a layer by longest path from a source,
 * stack nodes within a layer along the cross axis, and place layers along the flow axis per `direction`. Deterministic
 * and dependency-free so it lays out the same in a browser paint and in a report generated in Node, and is asserted without a DOM.
 */
import { directionOf, type TGraph } from "../../domains/graph.js";
import { itemAt, valueAt } from "@haibun/core/lib/domains/item-at.js";

export type NodeBox = { x: number; y: number; w: number; h: number };
export type GroupBox = { id: string; label: string; depth: number; x: number; y: number; w: number; h: number };
export type LaidOutGraph = { nodes: Map<string, NodeBox>; groups: GroupBox[]; width: number; height: number };

const NODE_H = 30;
const CHAR_W = 7.2;
const NODE_PAD_X = 12;
const LAYER_GAP = 64; // space between adjacent layers, along the flow axis
const SIBLING_GAP = 20; // space between nodes within a layer, along the cross axis
const GROUP_PAD = 12; // breathing room a group box adds around its members per nesting level
/** The most parts of one node a layer places in a row before it wraps them into another. */
const LAYER_ROW_NODES = 8;

export const nodeWidth = (label: string): number => Math.max(56, Math.round(label.length * CHAR_W) + NODE_PAD_X * 2);

/** How the layout sizes nodes and the gaps between them. A paint in pixels passes PIXEL_METRICS; a consumer in another
 *  coordinate space passes its own node footprint and gaps, so the boxes land in that space directly. */
export type LayeredMetrics = { node: (id: string, label: string) => { w: number; h: number }; layerGap: number; siblingGap: number };

/** The pixel estimate of a node (nodeWidth × NODE_H) and the gaps of a paint in pixels. */
export const PIXEL_METRICS: LayeredMetrics = { node: (_id, label) => ({ w: nodeWidth(label), h: NODE_H }), layerGap: LAYER_GAP, siblingGap: SIBLING_GAP };

/** Longest-path layering towards the sinks: a node sinks to the layer just before the nearest layer of the nodes it points
 * to, so the layout places a node beside its targets and keeps the parts of a node together, however deep each part goes.
 * layer(n) = min over out-edges of layer(target) − 1, with the sinks on the last layer; nodes left in a cycle keep the
 * layer they reached. */
function assignLayers(ids: string[], out: Map<string, string[]>): Map<string, number> {
	const height = new Map<string, number>();
	const heightOf = (id: string, path: Set<string>): number => {
		const held = height.get(id);
		if (held !== undefined) return held;
		path.add(id);
		const targets = valueAt(out, id, "the out-edges").filter((to) => !path.has(to));
		const h = targets.length === 0 ? 0 : Math.max(...targets.map((to) => heightOf(to, path))) + 1;
		path.delete(id);
		height.set(id, h);
		return h;
	};
	for (const id of ids) heightOf(id, new Set());
	const top = Math.max(0, ...height.values());
	return new Map(ids.map((id) => [id, top - valueAt(height, id, "the heights")]));
}

export function layeredLayout(graph: TGraph, metrics: LayeredMetrics): LaidOutGraph {
	const dir = directionOf(graph);
	const horizontal = dir === "LR" || dir === "RL";
	const reverse = dir === "RL" || dir === "BT";
	const ids = graph.nodes.map((n) => n.id);
	const idSet = new Set(ids);
	const sizeOf = new Map(graph.nodes.map((n) => [n.id, metrics.node(n.id, n.label)]));

	const out = new Map<string, string[]>(ids.map((id) => [id, []]));
	for (const e of graph.edges) if (idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to) valueAt(out, e.from, "the out-edges").push(e.to);

	const layer = assignLayers(ids, out);
	const layerOf = (id: string): number => valueAt(layer, id, "the layers");
	const maxLayer = ids.reduce((m, id) => Math.max(m, layerOf(id)), 0);
	const byLayer = new Map<number, string[]>(Array.from({ length: maxLayer + 1 }, (_, l) => [l, []]));
	for (const id of ids) valueAt(byLayer, layerOf(id), "the layers' nodes").push(id);

	const sizeWH = (id: string): { w: number; h: number } => valueAt(sizeOf, id, "the node sizes");
	const flowSize = (id: string): number => (horizontal ? sizeWH(id).w : sizeWH(id).h);
	const crossSize = (id: string): number => (horizontal ? sizeWH(id).h : sizeWH(id).w);

	// Each layer's nodes follow the order of the nodes they point to, so the parts of one node stay together. A run of parts
	// of one node longer than LAYER_ROW_NODES wraps into rows, so a node of many parts draws as a block under it rather
	// than as one row as wide as its parts.
	for (let l = maxLayer - 1; l >= 0; l--) {
		const above = new Map(valueAt(byLayer, l + 1, "the layers' nodes").map((id, at) => [id, at]));
		const rank = (id: string): number => Math.min(...valueAt(out, id, "the out-edges").flatMap((to) => (above.has(to) ? [valueAt(above, to, "the order above")] : [])));
		valueAt(byLayer, l, "the layers' nodes").sort((a, b) => rank(a) - rank(b));
	}
	const rowOf = new Map<string, number>();
	const crossCenterOf = new Map<string, number>();
	const layerCrossExtent: number[] = [];
	const layerRows: number[] = [];
	for (let l = 0; l <= maxLayer; l++) {
		const layerIds = valueAt(byLayer, l, "the layers' nodes");
		let c = 0;
		let rows = 1;
		for (let start = 0; start < layerIds.length; ) {
			const parent = itemAt(valueAt(out, itemAt(layerIds, start), "the out-edges").slice(0, 1).concat(""), 0);
			let end = start + 1;
			while (end < layerIds.length && itemAt(valueAt(out, itemAt(layerIds, end), "the out-edges").slice(0, 1).concat(""), 0) === parent) end++;
			const run = layerIds.slice(start, end);
			const cols = parent === "" ? run.length : Math.min(LAYER_ROW_NODES, run.length);
			// A column is as wide as its widest node, so a run in one row packs to its nodes' own widths.
			const widths = Array.from({ length: cols }, (_, col) => run.reduce((m, id, at) => (at % cols === col ? Math.max(m, crossSize(id)) : m), 0) + metrics.siblingGap);
			const starts = widths.map((_, col) => widths.slice(0, col).reduce((sum, w) => sum + w, c));
			run.forEach((id, at) => {
				rowOf.set(id, Math.floor(at / cols));
				crossCenterOf.set(id, itemAt(starts, at % cols) + crossSize(id) / 2);
			});
			rows = Math.max(rows, Math.ceil(run.length / cols));
			c += widths.reduce((sum, w) => sum + w, 0);
			start = end;
		}
		layerCrossExtent[l] = Math.max(0, c - metrics.siblingGap);
		layerRows[l] = rows;
	}
	const maxCross = layerCrossExtent.reduce((m, e) => Math.max(m, e), 0);

	// Flow-axis band per layer: the widest node in the layer per row, and a gap.
	const layerFlow: number[] = [];
	const rowFlow: number[] = [];
	let flowAcc = 0;
	for (let l = 0; l <= maxLayer; l++) {
		const band = valueAt(byLayer, l, "the layers' nodes").reduce((m, id) => Math.max(m, flowSize(id)), 0);
		const row = band + metrics.siblingGap;
		layerFlow[l] = flowAcc + band / 2;
		rowFlow[l] = row;
		flowAcc += itemAt(layerRows, l) * row - metrics.siblingGap + metrics.layerGap;
	}
	const totalFlow = Math.max(0, flowAcc - metrics.layerGap);

	const nodes = new Map<string, NodeBox>();
	for (const n of graph.nodes) {
		const l = layerOf(n.id);
		const flowAt = itemAt(layerFlow, l) + valueAt(rowOf, n.id, "the rows") * itemAt(rowFlow, l);
		const flowCenter = reverse ? totalFlow - flowAt : flowAt;
		const crossCenter = valueAt(crossCenterOf, n.id, "the cross-axis centres") + (maxCross - itemAt(layerCrossExtent, l)) / 2;
		const { w, h } = sizeWH(n.id);
		const cx = horizontal ? flowCenter : crossCenter;
		const cy = horizontal ? crossCenter : flowCenter;
		nodes.set(n.id, { x: cx - w / 2, y: cy - h / 2, w, h });
	}

	const groups = layoutGroups(graph, nodes);
	const width = horizontal ? totalFlow : maxCross;
	const height = horizontal ? maxCross : totalFlow;
	return { nodes, groups, width: Math.max(width, 1), height: Math.max(height, 1) };
}

/** A group box is the bounding box of its transitive member nodes, padded one step per nesting level so a parent
 * visibly encloses its children. Drawn outermost-first (depth ascending). */
function layoutGroups(graph: TGraph, nodes: Map<string, NodeBox>): GroupBox[] {
	const defs = graph.groups;
	if (!defs) return [];
	const depthOf = (id: string): number => {
		let d = 0;
		let g = defs[id]?.parent;
		const guard = new Set<string>();
		while (g && !guard.has(g)) {
			guard.add(g);
			d++;
			g = defs[g]?.parent;
		}
		return d;
	};
	const isDescendant = (groupId: string, of: string): boolean => {
		let g: string | undefined = groupId;
		const guard = new Set<string>();
		while (g && !guard.has(g)) {
			if (g === of) return true;
			guard.add(g);
			g = defs[g]?.parent;
		}
		return false;
	};
	const maxDepth = Object.keys(defs).reduce((m, id) => Math.max(m, depthOf(id)), 0);
	const out: GroupBox[] = [];
	for (const [id, g] of Object.entries(defs)) {
		const members = graph.nodes.filter((n) => n.group && isDescendant(n.group, id)).map((n) => nodes.get(n.id));
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const b of members) {
			if (!b) continue;
			minX = Math.min(minX, b.x);
			minY = Math.min(minY, b.y);
			maxX = Math.max(maxX, b.x + b.w);
			maxY = Math.max(maxY, b.y + b.h);
		}
		if (!Number.isFinite(minX)) continue;
		const depth = depthOf(id);
		const pad = GROUP_PAD * (maxDepth - depth + 1);
		out.push({ id, label: g.label, depth, x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad });
	}
	return out.sort((a, b) => a.depth - b.depth);
}
