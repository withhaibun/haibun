/**
 * Layered (Sugiyama-lite) layout for a directed graph: assign each node a layer by longest path from a source,
 * stack nodes within a layer along the cross axis, and place layers along the flow axis per `direction`. Deterministic
 * and dependency-free so it lays out the same in a browser paint and in a Node bake, and is asserted without a DOM.
 */
import type { TGraph } from "./types.js";

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

/** How the layout sizes nodes and the gaps between them. Default is the pixel estimate (nodeWidth × NODE_H); a consumer in
 *  another coordinate space passes its own node footprint + gaps so the boxes land in that space directly. */
export type LayeredMetrics = { node: (id: string, label: string) => { w: number; h: number }; layerGap: number; siblingGap: number };
const DEFAULT_METRICS: LayeredMetrics = { node: (_id, label) => ({ w: nodeWidth(label), h: NODE_H }), layerGap: LAYER_GAP, siblingGap: SIBLING_GAP };

/** Longest-path layering: layer(n) = max over incoming edges of layer(src)+1, computed in topological order; nodes left
 * in a cycle keep the layer they reached. */
function assignLayers(ids: string[], out: Map<string, string[]>, indeg: Map<string, number>): Map<string, number> {
	const remaining = new Map(indeg);
	const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
	const topo: string[] = [];
	const seen = new Set<string>();
	while (queue.length) {
		const u = queue.shift() as string;
		if (seen.has(u)) continue;
		seen.add(u);
		topo.push(u);
		for (const v of out.get(u) ?? []) {
			remaining.set(v, (remaining.get(v) ?? 0) - 1);
			if ((remaining.get(v) ?? 0) <= 0) queue.push(v);
		}
	}
	for (const id of ids) if (!seen.has(id)) topo.push(id); // cycle remnants, stable order
	const layer = new Map<string, number>(ids.map((id) => [id, 0]));
	for (const u of topo) for (const v of out.get(u) ?? []) layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
	return layer;
}

export function layeredLayout(graph: TGraph, metrics: LayeredMetrics = DEFAULT_METRICS): LaidOutGraph {
	const dir = graph.direction ?? "LR";
	const horizontal = dir === "LR" || dir === "RL";
	const reverse = dir === "RL" || dir === "BT";
	const ids = graph.nodes.map((n) => n.id);
	const idSet = new Set(ids);
	const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));
	const sizeOf = new Map(ids.map((id) => [id, metrics.node(id, labelOf.get(id) ?? id)]));

	const out = new Map<string, string[]>(ids.map((id) => [id, []]));
	const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
	for (const e of graph.edges) {
		if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
		(out.get(e.from) as string[]).push(e.to);
		indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
	}

	const layer = assignLayers(ids, out, indeg);
	const maxLayer = ids.reduce((m, id) => Math.max(m, layer.get(id) ?? 0), 0);
	const byLayer = new Map<number, string[]>();
	for (const id of ids) {
		const l = layer.get(id) ?? 0;
		const bucket = byLayer.get(l);
		if (bucket) bucket.push(id);
		else byLayer.set(l, [id]);
	}

	const sizeWH = (id: string): { w: number; h: number } => sizeOf.get(id) ?? { w: 1, h: 1 };
	const flowSize = (id: string): number => (horizontal ? sizeWH(id).w : sizeWH(id).h);
	const crossSize = (id: string): number => (horizontal ? sizeWH(id).h : sizeWH(id).w);

	// Flow-axis band per layer: widest node in the layer + a gap.
	const layerFlow: number[] = [];
	let flowAcc = 0;
	for (let l = 0; l <= maxLayer; l++) {
		const band = (byLayer.get(l) ?? []).reduce((m, id) => Math.max(m, flowSize(id)), 0);
		layerFlow[l] = flowAcc + band / 2;
		flowAcc += band + metrics.layerGap;
	}
	const totalFlow = Math.max(0, flowAcc - metrics.layerGap);

	// Cross-axis stack within each layer; remember each layer's extent so layers can be centred against the widest one.
	const crossCenterOf = new Map<string, number>();
	const layerCrossExtent: number[] = [];
	for (let l = 0; l <= maxLayer; l++) {
		let c = 0;
		for (const id of byLayer.get(l) ?? []) {
			crossCenterOf.set(id, c + crossSize(id) / 2);
			c += crossSize(id) + metrics.siblingGap;
		}
		layerCrossExtent[l] = Math.max(0, c - metrics.siblingGap);
	}
	const maxCross = layerCrossExtent.reduce((m, e) => Math.max(m, e), 0);

	const nodes = new Map<string, NodeBox>();
	for (const n of graph.nodes) {
		const l = layer.get(n.id) ?? 0;
		const flowCenter = reverse ? totalFlow - layerFlow[l] : layerFlow[l];
		const crossCenter = (crossCenterOf.get(n.id) ?? 0) + (maxCross - layerCrossExtent[l]) / 2;
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
