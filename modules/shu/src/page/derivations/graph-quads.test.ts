import { describe, it, expect } from "vitest";
import { LinkRelations } from "@haibun/core/lib/domains/resources.js";
import { graphToQuads } from "./graph-quads.js";
import { buildGraphModelFromQuads } from "../../derivations/graph-model.js";
import { EDGE_KIND, NODE_KIND, type TGraph } from "../domains/graph.js";

const GRAPH: TGraph = {
	nodes: [
		{ id: "doc", label: "doc", kind: NODE_KIND.reachable },
		{ id: "holder", label: "holder", kind: NODE_KIND.satisfied },
		{ id: "alone", label: "a node with no edge" },
	],
	edges: [{ from: "holder", to: "doc", label: "issueDocument", kind: EDGE_KIND.ready }],
};

describe("a projected graph as the quads the scene draws", () => {
	it("draws each node as its kind, titled by its label, and each edge by its label", () => {
		const { quads, clusters } = graphToQuads(GRAPH);
		const model = buildGraphModelFromQuads(quads, { clusters });
		expect(model.nodes.map((n) => [n.id, n.type, n.displayLabel]).sort()).toEqual([
			["alone", NODE_KIND.default, "a node with no edge"],
			["doc", NODE_KIND.reachable, "doc"],
			["holder", NODE_KIND.satisfied, "holder"],
		]);
		expect(model.edges).toEqual([{ from: "holder", to: "doc", predicate: "issueDocument", graph: NODE_KIND.satisfied }]);
		expect(quads.filter((q) => q.predicate === LinkRelations.NAME.rel)).toHaveLength(GRAPH.nodes.length);
	});

	it("refuses an edge naming a node the graph does not hold", () => {
		expect(() => graphToQuads({ nodes: [], edges: [{ from: "a", to: "b" }] })).toThrow(/names node "a"/);
	});
});
