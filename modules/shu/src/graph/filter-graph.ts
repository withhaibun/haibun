/**
 * Pure axis filter for `TGraph`. Drops nodes and edges whose stepper or kind is
 * in the user's hidden set, then prunes any edge that lost an endpoint. Used by
 * the domain-chain view to filter the unified domains/waypoints/goals graph.
 */
import type { TGraph } from "./types.js";

export type TGraphFilter = {
	/** Stepper names the user has hidden. Edges matching these (by `stepperName`) drop, along with the orphans they leave. */
	hiddenSteppers?: ReadonlySet<string>;
	/** Node kinds the user has hidden. Nodes matching these drop, along with any edges that lose an endpoint. */
	hiddenKinds?: ReadonlySet<string>;
};

/** Enumerate the filter axes available in a graph: every stepper seen on an edge, every kind seen on a node. */
export function graphAxes(graph: TGraph): { steppers: string[]; kinds: string[] } {
	const steppers = new Set<string>();
	for (const e of graph.edges) if (e.stepperName) steppers.add(e.stepperName);
	const kinds = new Set<string>();
	for (const n of graph.nodes) if (n.kind) kinds.add(n.kind);
	return { steppers: [...steppers].sort(), kinds: [...kinds].sort() };
}

/**
 * Bidirectional neighbour map. For each node id, the set of node ids it is connected to
 * by any edge (regardless of direction). Used by the chain view's hover/select highlight
 * to surface a node's immediate context without the host walking edges on every event.
 */
export function buildNeighbors(graph: TGraph): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		if (!out.has(a)) out.set(a, new Set());
		out.get(a)?.add(b);
	};
	for (const e of graph.edges) {
		link(e.from, e.to);
		link(e.to, e.from);
	}
	return out;
}

/**
 * Transitive-closure of nodes reachable from `start` over `neighbors` (undirected). The
 * start node is included. Used by the selection highlight to focus the entire connected
 * component the user clicked on, rather than just immediate neighbours.
 */
export function connectedNodes(neighbors: Map<string, Set<string>>, start: string): Set<string> {
	const out = new Set<string>([start]);
	const queue = [start];
	while (queue.length > 0) {
		const cur = queue.shift();
		if (cur === undefined) break;
		for (const nb of neighbors.get(cur) ?? []) {
			if (out.has(nb)) continue;
			out.add(nb);
			queue.push(nb);
		}
	}
	return out;
}

export function filterGraph(graph: TGraph, filter: TGraphFilter): TGraph {
	const hiddenSteppers = filter.hiddenSteppers ?? new Set<string>();
	const hiddenKinds = filter.hiddenKinds ?? new Set<string>();
	if (hiddenSteppers.size === 0 && hiddenKinds.size === 0) return graph;
	const visibleNodes = graph.nodes.filter((n) => !hiddenKinds.has(n.kind ?? ""));
	const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
	const visibleEdges = graph.edges.filter((e) => {
		if (e.stepperName && hiddenSteppers.has(e.stepperName)) return false;
		return visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to);
	});
	return { ...graph, nodes: visibleNodes, edges: visibleEdges };
}
