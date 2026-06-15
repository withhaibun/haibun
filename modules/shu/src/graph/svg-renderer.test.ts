import { describe, it, expect } from "vitest";
import { graphToSvg, graphToDot } from "./svg-renderer.js";
import type { TGraph } from "./types.js";

const g: TGraph = {
	nodes: [
		{ id: "a", label: "Alpha", kind: "satisfied", group: "G" },
		{ id: "b", label: "Beta", group: "G" },
		{ id: "c", label: "Gamma" },
	],
	edges: [
		{ from: "a", to: "b", label: "to" },
		{ from: "b", to: "c", kind: "blocked" },
	],
	groups: { G: { label: "Group" } },
	direction: "LR",
};

describe("graphToSvg", () => {
	it("emits one g.node[data-node-id] per node, one g.edge[data-from/to] per edge, and group boxes", () => {
		const svg = graphToSvg(g);
		for (const id of ["a", "b", "c"]) expect(svg).toContain(`data-node-id="${id}"`);
		expect(svg).toContain('data-from="a" data-to="b"');
		expect(svg).toContain('data-from="b" data-to="c"');
		expect(svg).toContain('data-group-id="G"');
		expect((svg.match(/class="node"/g) ?? []).length).toBe(3);
		expect((svg.match(/class="edge"/g) ?? []).length).toBe(2);
	});

	it("applies the kind colour vocabulary and a hover-hint title", () => {
		const svg = graphToSvg(g);
		expect(svg).toContain("#d8edd8"); // satisfied fill
		expect(svg).toContain("<title>Alpha · satisfied</title>");
	});

	it("dims edges outside a highlighted path", () => {
		const paths: TGraph = { nodes: g.nodes, edges: [{ from: "a", to: "b", paths: ["p1"] }, { from: "b", to: "c", paths: ["p2"] }], direction: "LR" };
		const svg = graphToSvg(paths, { highlightedPath: "p1" });
		// the b→c edge (path p2, not p1) is dimmed
		const bc = svg.slice(svg.indexOf('data-from="b" data-to="c"'));
		expect(bc).toContain('opacity="0.3"');
	});

	it("is deterministic (same graph → identical markup)", () => {
		expect(graphToSvg(g)).toBe(graphToSvg(g));
	});
});

describe("graphToDot", () => {
	it("emits nodes, edges, clusters, and is deterministic", () => {
		const dot = graphToDot(g);
		expect(dot).toContain("digraph G {");
		expect(dot).toContain("rankdir=LR;");
		expect(dot).toContain('"a" [label="Alpha"');
		expect(dot).toContain('"a" -> "b"');
		expect(dot).toContain('subgraph "cluster_G"');
		expect(graphToDot(g)).toBe(graphToDot(g));
	});
});
