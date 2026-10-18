/**
 * A projected graph (the domain chain, a goal's paths) as the quads the graph scene draws. Each node is a subject whose
 * type is its kind and whose title is its label; each edge is a quad from its source to its target, whose predicate is
 * the edge's label. The scene draws only quads, so a view showing a projection shows it with the scene and its controls.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { kindOfEdge, kindOfNode, type TGraph } from "../domains/graph.js";

/** The quads of a projected graph, and one cluster per kind titling each of its nodes. */
export function graphToQuads(graph: TGraph): { quads: TQuad[]; clusters: TCluster[] } {
	const kinds = new Map(graph.nodes.map((node) => [node.id, kindOfNode(node)]));
	const kindOf = (id: string): string => {
		const kind = kinds.get(id);
		if (kind === undefined) throw new Error(`graph edge names node "${id}", which the graph does not hold`);
		return kind;
	};
	const quads: TQuad[] = graph.nodes.map((node) => ({ subject: node.id, predicate: LinkRelations.NAME.rel, object: node.label, namedGraph: kindOf(node.id), timestamp: 0 }));
	for (const edge of graph.edges) {
		// An edge's predicate is its label, else its relation, else its kind.
		const predicate = edge.label ?? edge.rel ?? kindOfEdge(edge);
		quads.push({ subject: edge.from, predicate, object: edge.to, namedGraph: kindOf(edge.from), objectType: kindOf(edge.to), timestamp: 0 });
	}
	const byKind = new Map<string, TGraph["nodes"]>();
	for (const node of graph.nodes) {
		const kind = byKind.get(kindOf(node.id));
		if (kind === undefined) byKind.set(kindOf(node.id), [node]);
		else kind.push(node);
	}
	const clusters: TCluster[] = [...byKind].map(([type, nodes]) => ({
		type,
		totalCount: nodes.length,
		sampledCount: nodes.length,
		omittedCount: 0,
		sampledSubjects: nodes.map((node) => node.id),
		displayLabels: Object.fromEntries(nodes.map((node) => [node.id, node.label])),
	}));
	return { quads, clusters };
}
