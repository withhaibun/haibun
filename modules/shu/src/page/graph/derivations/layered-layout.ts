/**
 * Layered (Sugiyama-lite) layout for a directed graph: assign each node a layer by longest path from a source,
 * stack nodes within a layer along the cross axis, and place layers along the flow axis per `direction`. Deterministic
 * and dependency-free so it lays out the same in a browser paint and in a report generated in Node, and is asserted without a DOM.
 */
import { directionOf, type TGraph } from "../../domains/graph.js";
import { itemAt, valueAt } from "@haibun/core/lib/util/item-at.js";

export type NodeBox = { x: number; y: number; w: number; h: number };
export type GroupBox = { id: string; label: string; depth: number; x: number; y: number; w: number; h: number };
export type LaidOutGraph = { nodes: Map<string, NodeBox>; groups: GroupBox[]; width: number; height: number };

const NODE_H = 30;
const CHAR_W = 7.2;
const NODE_PAD_X = 12;
const LAYER_GAP = 64; // space between adjacent layers, along the flow axis
const SIBLING_GAP = 20; // space between nodes within a layer, along the cross axis
const GROUP_PAD = 12; // breathing room a group box adds around its members per nesting level

export const nodeWidth = (label: string): number => Math.max(56, Math.round(label.length * CHAR_W) + NODE_PAD_X * 2);

/** How the layout sizes nodes and the gaps between them. A paint in pixels passes PIXEL_METRICS; a consumer in another
 *  coordinate space passes its own node footprint and gaps, so the boxes land in that space directly. */
export type LayeredMetrics = { node: (id: string, label: string) => { w: number; h: number }; layerGap: number; siblingGap: number };

/** The pixel estimate of a node (nodeWidth × NODE_H) and the gaps of a paint in pixels. */
export const PIXEL_METRICS: LayeredMetrics = { node: (_id, label) => ({ w: nodeWidth(label), h: NODE_H }), layerGap: LAYER_GAP, siblingGap: SIBLING_GAP };

/** Longest-path layering: layer(n) = max over incoming edges of layer(src)+1, computed in topological order; nodes left
 * in a cycle keep the layer they reached. */
function assignLayers(ids: string[], out: Map<string, string[]>, indeg: Map<string, number>): Map<string, number> {
	const remaining = new Map(indeg);
	const queue = ids.filter((id) => valueAt(indeg, id, "the in-degrees") === 0);
	const topo: string[] = [];
	const seen = new Set<string>();
	while (queue.length) {
		const u = queue.shift() as string;
		if (seen.has(u)) continue;
		seen.add(u);
		topo.push(u);
		for (const v of valueAt(out, u, "the out-edges")) {
			const left = valueAt(remaining, v, "the remaining in-degrees") - 1;
			remaining.set(v, left);
			if (left <= 0) queue.push(v);
		}
	}
	for (const id of ids) if (!seen.has(id)) topo.push(id); // cycle remnants, stable order
	const layer = new Map<string, number>(ids.map((id) => [id, 0]));
	const layerOf = (id: string): number => valueAt(layer, id, "the layers");
	for (const u of topo) for (const v of valueAt(out, u, "the out-edges")) layer.set(v, Math.max(layerOf(v), layerOf(u) + 1));
	return layer;
}

export function layeredLayout(graph: TGraph, metrics: LayeredMetrics): LaidOutGraph {
	const dir = directionOf(graph);
	const horizontal = dir === "LR" || dir === "RL";
	const reverse = dir === "RL" || dir === "BT";
	const ids = graph.nodes.map((n) => n.id);
	const idSet = new Set(ids);
	const sizeOf = new Map(graph.nodes.map((n) => [n.id, metrics.node(n.id, n.label)]));

	const out = new Map<string, string[]>(ids.map((id) => [id, []]));
	const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
	for (const e of graph.edges) {
		if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
		valueAt(out, e.from, "the out-edges").push(e.to);
		indeg.set(e.to, valueAt(indeg, e.to, "the in-degrees") + 1);
	}

	const layer = assignLayers(ids, out, indeg);
	const layerOf = (id: string): number => valueAt(layer, id, "the layers");
	const maxLayer = ids.reduce((m, id) => Math.max(m, layerOf(id)), 0);
	const byLayer = new Map<number, string[]>(Array.from({ length: maxLayer + 1 }, (_, l) => [l, []]));
	for (const id of ids) valueAt(byLayer, layerOf(id), "the layers' nodes").push(id);

	const sizeWH = (id: string): { w: number; h: number } => valueAt(sizeOf, id, "the node sizes");
	const flowSize = (id: string): number => (horizontal ? sizeWH(id).w : sizeWH(id).h);
	const crossSize = (id: string): number => (horizontal ? sizeWH(id).h : sizeWH(id).w);

	// Flow-axis band per layer: widest node in the layer + a gap.
	const layerFlow: number[] = [];
	let flowAcc = 0;
	for (let l = 0; l <= maxLayer; l++) {
		const band = valueAt(byLayer, l, "the layers' nodes").reduce((m, id) => Math.max(m, flowSize(id)), 0);
		layerFlow[l] = flowAcc + band / 2;
		flowAcc += band + metrics.layerGap;
	}
	const totalFlow = Math.max(0, flowAcc - metrics.layerGap);

	// Cross-axis stack within each layer; record each layer's extent so layers can be centred against the widest one.
	const crossCenterOf = new Map<string, number>();
	const layerCrossExtent: number[] = [];
	for (let l = 0; l <= maxLayer; l++) {
		let c = 0;
		for (const id of valueAt(byLayer, l, "the layers' nodes")) {
			crossCenterOf.set(id, c + crossSize(id) / 2);
			c += crossSize(id) + metrics.siblingGap;
		}
		layerCrossExtent[l] = Math.max(0, c - metrics.siblingGap);
	}
	const maxCross = layerCrossExtent.reduce((m, e) => Math.max(m, e), 0);

	const nodes = new Map<string, NodeBox>();
	for (const n of graph.nodes) {
		const l = layerOf(n.id);
		const flowAt = itemAt(layerFlow, l);
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
