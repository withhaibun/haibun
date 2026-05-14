import { describe, it, expect } from "vitest";
import { buildNeighbors, connectedNodes, filterGraph, graphAxes } from "./filter-graph.js";
import type { TGraph } from "./types.js";

const sampleGraph = (): TGraph => ({
	direction: "LR",
	nodes: [
		{ id: "a", label: "a", kind: "satisfied" },
		{ id: "b", label: "b", kind: "reachable" },
		{ id: "c", label: "c", kind: "unreachable" },
		{ id: "waypoint:W", label: "waypoint W", kind: "waypoint-imperative" },
	],
	edges: [
		{ from: "a", to: "b", label: "alpha", stepperName: "Alpha", stepName: "alpha" },
		{ from: "b", to: "c", label: "beta", stepperName: "Beta", stepName: "beta" },
		{ from: "c", to: "waypoint:W", label: "ensures" },
	],
});

describe("graphAxes", () => {
	it("enumerates the steppers from edges and kinds from nodes", () => {
		const a = graphAxes(sampleGraph());
		expect(a.steppers).toEqual(["Alpha", "Beta"]);
		expect(a.kinds).toEqual(["reachable", "satisfied", "unreachable", "waypoint-imperative"]);
	});
});

describe("buildNeighbors", () => {
	it("links each node to every other node it shares an edge with, regardless of direction", () => {
		const g = sampleGraph();
		const n = buildNeighbors(g);
		// a → b: both directions
		expect(n.get("a")?.has("b")).toBe(true);
		expect(n.get("b")?.has("a")).toBe(true);
		// b → c → waypoint:W: chain transitively visible only via direct edges
		expect(n.get("b")?.has("c")).toBe(true);
		expect(n.get("c")?.has("b")).toBe(true);
		expect(n.get("c")?.has("waypoint:W")).toBe(true);
		expect(n.get("waypoint:W")?.has("c")).toBe(true);
		// a should NOT neighbour c — they don't share an edge.
		expect(n.get("a")?.has("c")).toBe(false);
	});

	it("returns an empty map for a graph with no edges", () => {
		const empty = buildNeighbors({ nodes: [{ id: "x", label: "x" }], edges: [] });
		expect(empty.size).toBe(0);
	});
});

describe("connectedNodes", () => {
	it("includes the start node plus every transitively-reachable neighbour", () => {
		// Chain: a-b-c-waypoint:W, plus a disconnected island {x,y}.
		const g: TGraph = {
			direction: "LR",
			nodes: [
				{ id: "a", label: "a" },
				{ id: "b", label: "b" },
				{ id: "c", label: "c" },
				{ id: "waypoint:W", label: "W" },
				{ id: "x", label: "x" },
				{ id: "y", label: "y" },
			],
			edges: [
				{ from: "a", to: "b" },
				{ from: "b", to: "c" },
				{ from: "c", to: "waypoint:W" },
				{ from: "x", to: "y" },
			],
		};
		const n = buildNeighbors(g);
		const reached = connectedNodes(n, "a");
		expect([...reached].sort()).toEqual(["a", "b", "c", "waypoint:W"]);
		// Disconnected island is not reached.
		expect(reached.has("x")).toBe(false);
	});

	it("returns just the start node when it has no edges", () => {
		const g: TGraph = { nodes: [{ id: "lonely", label: "lonely" }], edges: [] };
		const n = buildNeighbors(g);
		expect([...connectedNodes(n, "lonely")]).toEqual(["lonely"]);
	});
});

describe("filterGraph", () => {
	it("returns the original graph (same reference) when nothing is hidden", () => {
		const g = sampleGraph();
		expect(filterGraph(g, {})).toBe(g);
		expect(filterGraph(g, { hiddenSteppers: new Set(), hiddenKinds: new Set() })).toBe(g);
	});

	it("drops edges whose stepper is hidden", () => {
		const filtered = filterGraph(sampleGraph(), { hiddenSteppers: new Set(["Alpha"]) });
		expect(filtered.edges.find((e) => e.stepperName === "Alpha")).toBeUndefined();
		expect(filtered.edges.find((e) => e.stepperName === "Beta")).toBeTruthy();
		// Nodes stay even if no edge connects them after stepper-filtering.
		expect(filtered.nodes).toHaveLength(4);
	});

	it("drops nodes whose kind is hidden and prunes edges that lose an endpoint", () => {
		const filtered = filterGraph(sampleGraph(), { hiddenKinds: new Set(["waypoint-imperative"]) });
		expect(filtered.nodes.find((n) => n.id === "waypoint:W")).toBeUndefined();
		// The ensures edge (c → waypoint:W) lost its target node, so it must be pruned.
		expect(filtered.edges.find((e) => e.to === "waypoint:W")).toBeUndefined();
		// Untouched edges stay.
		expect(filtered.edges.find((e) => e.from === "a" && e.to === "b")).toBeTruthy();
	});

	it("combines stepper and kind axes", () => {
		const filtered = filterGraph(sampleGraph(), {
			hiddenSteppers: new Set(["Beta"]),
			hiddenKinds: new Set(["unreachable"]),
		});
		expect(filtered.nodes.find((n) => n.id === "c")).toBeUndefined();
		expect(filtered.edges.find((e) => e.stepperName === "Beta")).toBeUndefined();
		// a → b survives.
		expect(filtered.edges.find((e) => e.from === "a" && e.to === "b")).toBeTruthy();
	});
});
