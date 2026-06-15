// @vitest-environment jsdom
// Graph hover/click navigation over the SVG paint. bindSvg must (1) map every painted `g.node[data-node-id]` back to
// currentNodeMap, (2) resolve adjacency from the TGraph edges (carried on `g.edge[data-from/to]`, never parsed out of an
// id — node ids embed `_` and spaces), and (3) toggle `.filter-highlight` on `.diagram-container`, not the inner leaf the
// SVG is injected into. Each was a real regression that made hover do nothing / highlight wrong nodes.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraphView } from "./shu-graph-view.js";
import { graphToSvg, findSvgNodes } from "../graph/svg-renderer.js";
import { buildGraphTopology } from "../graph/graph-topology.js";
import { THREAD_CLASSIFIER, type TGraphViewOpts } from "../graph-classifier.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import type { TGraph } from "../graph/types.js";

type Probe = {
	currentNodeMap: Map<string, { graph: string; subject: string }>;
	svgNeighbors: Map<string, Set<string>>;
	svgNodeElements: Map<string, Element>;
	bindSvg(graph: TGraph, container: Element): void;
};

// Real-world ids: embedded `_` and spaces (the topology delimits `${graph} ${subject}`), so id parsing would mislink.
const ISSUER = "Issuer did_web_tethys_osf";
const VM = "VerificationMethod did_web_tethys_osf_key-1";
const PERSON = "Person bron_sledge_osf";

const graphOf = (nodes: string[], edges: Array<[string, string]>): TGraph => ({
	nodes: nodes.map((id) => ({ id, label: id, group: id.split(" ")[0] })),
	edges: edges.map(([from, to]) => ({ from, to, rel: "rel" })),
	direction: "LR",
});

/** Mirror the live DOM (`.diagram-container > #host > svg`) painted by `graphToSvg`, and wire currentNodeMap as renderSvg does. */
const makeView = (graph: TGraph): { el: Probe; container: HTMLElement; host: HTMLElement } => {
	const el = document.createElement("shu-graph-view") as unknown as Probe;
	el.currentNodeMap = new Map(graph.nodes.map((n) => [n.id, { graph: n.group ?? n.id, subject: n.id }]));
	const container = document.createElement("div");
	container.className = "diagram-container";
	const host = document.createElement("div");
	container.appendChild(host);
	host.innerHTML = graphToSvg(graph);
	return { el, container, host };
};

describe("shu-graph-view SVG navigation (hover/click adjacency)", () => {
	beforeEach(() => {
		if (!customElements.get("shu-graph-view")) customElements.define("shu-graph-view", ShuGraphView);
	});

	it("binds every painted node back to currentNodeMap (so clicking never desyncs)", () => {
		const nodes = [ISSUER, VM, PERSON];
		const { el, host } = makeView(graphOf(nodes, [[ISSUER, VM]]));
		el.bindSvg(graphOf(nodes, [[ISSUER, VM]]), host);
		expect([...el.svgNodeElements.keys()].sort()).toEqual([...nodes].sort());
		for (const rawId of el.svgNodeElements.keys()) expect(el.currentNodeMap.has(rawId)).toBe(true);
	});

	it("resolves adjacency from the graph edges despite underscores and spaces in node ids", () => {
		const graph = graphOf([ISSUER, VM, PERSON], [[ISSUER, VM], [ISSUER, PERSON]]);
		const { el, host } = makeView(graph);
		el.bindSvg(graph, host);
		expect([...(el.svgNeighbors.get(ISSUER) ?? [])].sort()).toEqual([PERSON, VM].sort());
		expect([...(el.svgNeighbors.get(VM) ?? [])]).toEqual([ISSUER]);
		expect([...(el.svgNeighbors.get(PERSON) ?? [])]).toEqual([ISSUER]);
	});

	it("never mislinks ambiguous-looking ids (adjacency rides data-from/to, not the id)", () => {
		// Ids "A","A B","B C","C" make a parsed edge id ambiguous (A→B C or A B→C). The data attributes are unambiguous.
		const graph = graphOf(["A", "A B", "B C", "C"], [["A B", "C"]]);
		const { el, host } = makeView(graph);
		el.bindSvg(graph, host);
		expect([...(el.svgNeighbors.get("A B") ?? [])]).toEqual(["C"]);
		expect([...(el.svgNeighbors.get("C") ?? [])]).toEqual(["A B"]);
		expect(el.svgNeighbors.get("A") ?? new Set()).toEqual(new Set()); // not mislinked
		expect(el.svgNeighbors.get("B C") ?? new Set()).toEqual(new Set());
	});

	it("topology node ids survive the SVG attribute round-trip (the delimiter is DOM-safe, not a NUL)", () => {
		// buildGraphTopology delimits ids with a sentinel char; if it were XML-illegal (NUL), the browser would mangle
		// `data-node-id` and findSvgNodes would never match currentNodeMap — every node click would throw.
		const quad = (namedGraph: string, subject: string, predicate: string, object: string, objectType?: string): TQuad =>
			({ namedGraph, subject, predicate, object, objectType }) as TQuad;
		const opts: TGraphViewOpts = { layout: "TD", hiddenGraphs: new Set(), expandedGraphs: new Set(), maxPerSubgraph: 20, displayLabel: () => undefined };
		const { graph, nodeMap } = buildGraphTopology([quad("Person", "p1", "name", "Alice"), quad("Email", "e1", "attributedTo", "p1", "Person")], opts, THREAD_CLASSIFIER);
		const host = document.createElement("div");
		host.innerHTML = graphToSvg(graph);
		const found = findSvgNodes(graph, host);
		for (const id of graph.nodes.map((n) => n.id)) expect(found.has(id)).toBe(true);
		for (const id of nodeMap.keys()) expect(found.get(id)).toBeTruthy(); // clickable entities resolve back to their map entry
	});

	it("hover highlights the node + its neighbors, dimming via the .diagram-container (not the inner leaf)", () => {
		const graph = graphOf([ISSUER, VM, PERSON], [[ISSUER, VM]]);
		const { el, container, host } = makeView(graph);
		el.bindSvg(graph, host);
		el.svgNodeElements.get(ISSUER)?.dispatchEvent(new Event("mouseenter"));
		// The dim/highlight CSS keys off `.diagram-container.filter-highlight`, so the class must land on the container.
		expect(container.classList.contains("filter-highlight")).toBe(true);
		expect(host.classList.contains("filter-highlight")).toBe(false);
		expect(el.svgNodeElements.get(ISSUER)?.classList.contains("filter-match")).toBe(true);
		expect(el.svgNodeElements.get(VM)?.classList.contains("filter-match")).toBe(true);
		expect(el.svgNodeElements.get(PERSON)?.classList.contains("filter-match")).toBe(false);
	});
});
