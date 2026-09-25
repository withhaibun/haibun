/**
 * The neighbours of a `TGraph`'s nodes, which `shu-graph` highlights: a node's immediate neighbours on hover, the
 * connected component of the selected node.
 */
import type { TGraph } from "./types.js";

/**
 * Bidirectional neighbour map. For each node id, the set of node ids it is connected to
 * by any edge (regardless of direction). Read by the hover highlight to surface a node's
 * immediate context without walking edges on every event.
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
 * component of the selected node, rather than just immediate neighbours.
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
