// @vitest-environment jsdom
// Graph hover/click navigation. bindNodeClicks must (1) map every server-rendered SVG node back to currentNodeMap,
// (2) resolve adjacency from the render-ordered drawnEdges (NOT by parsing the ambiguous edge-path id — node ids embed
// `_`, so `L_A_B_C` could be A→B_C or A_B→C), and (3) toggle `.filter-highlight` on `.diagram-container`, not the inner
// leaf the SVG is injected into. Each was a real regression that made hover do nothing / click highlight wrong nodes.
import { describe, it, expect, beforeEach } from "vitest";
import { ShuGraphView } from "./shu-graph-view.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Mirror the live DOM: `.diagram-container > #host > svg`, with `…-flowchart-<rawId>-<n>` nodes and `path.flowchart-link`
 *  edges in render order (their ids are deliberately ambiguous — adjacency must NOT depend on them). Returns the host
 *  (the element renderMermaid passes to bindNodeClicks) and the container. */
function makeMermaidGraph(nodes: string[], edges: Array<[string, string]>): { container: HTMLElement; host: HTMLElement } {
	const container = document.createElement("div");
	container.className = "diagram-container";
	const host = document.createElement("div");
	host.id = "diagram-host";
	container.appendChild(host);
	const svg = document.createElementNS(SVG_NS, "svg");
	host.appendChild(svg);
	nodes.forEach((rawId, i) => {
		const g = document.createElementNS(SVG_NS, "g");
		g.setAttribute("id", `mr-5-flowchart-${rawId}-${i}`);
		g.setAttribute("class", "node");
		svg.appendChild(g);
	});
	const edgeLabels = document.createElementNS(SVG_NS, "g");
	edgeLabels.setAttribute("class", "edgeLabels");
	edges.forEach(([from, to], i) => {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("class", "flowchart-link");
		path.setAttribute("id", `mr-5-L_${from}_${to}_${i}`);
		svg.appendChild(path);
		const label = document.createElementNS(SVG_NS, "g");
		label.setAttribute("class", "edgeLabel");
		label.textContent = "rel";
		edgeLabels.appendChild(label);
	});
	svg.appendChild(edgeLabels);
	return { container, host };
}

type Probe = {
	currentNodeMap: Map<string, { graph: string; subject: string }>;
	currentDrawnEdges: { from: string; to: string }[];
	svgNeighbors: Map<string, Set<string>>;
	svgNodeElements: Map<string, Element>;
	bindNodeClicks(container: Element): void;
};

const ISSUER = "Issuer_did_web_tethys_osf";
const VM = "VerificationMethod_did_web_tethys_osf_key-1";
const PERSON = "Person_bron_sledge_osf";

/** Build a view with the given nodes + edges wired through currentNodeMap/currentDrawnEdges (as renderMermaid does). */
const makeView = (nodes: string[], edges: Array<[string, string]>): { el: Probe; container: HTMLElement; host: HTMLElement } => {
	const el = document.createElement("shu-graph-view") as unknown as Probe;
	el.currentNodeMap = new Map(nodes.map((n) => [n, { graph: n.split("_")[0], subject: n }]));
	el.currentDrawnEdges = edges.map(([from, to]) => ({ from, to }));
	const { container, host } = makeMermaidGraph(nodes, edges);
	return { el, container, host };
};

describe("shu-graph-view SVG navigation (hover/click adjacency)", () => {
	beforeEach(() => {
		if (!customElements.get("shu-graph-view")) customElements.define("shu-graph-view", ShuGraphView);
	});

	it("binds every node whose rawId is in currentNodeMap (so clicking never desyncs)", () => {
		const nodes = [ISSUER, VM, PERSON];
		const { el, host } = makeView(nodes, [[ISSUER, VM]]);
		el.bindNodeClicks(host);
		expect([...el.svgNodeElements.keys()].sort()).toEqual([...nodes].sort());
		for (const rawId of el.svgNodeElements.keys()) expect(el.currentNodeMap.has(rawId)).toBe(true);
	});

	it("resolves adjacency from drawnEdges despite underscores and `-N` suffixes in node ids", () => {
		const { el, host } = makeView([ISSUER, VM, PERSON], [[ISSUER, VM], [ISSUER, PERSON]]);
		el.bindNodeClicks(host);
		expect([...(el.svgNeighbors.get(ISSUER) ?? [])].sort()).toEqual([PERSON, VM].sort());
		expect([...(el.svgNeighbors.get(VM) ?? [])]).toEqual([ISSUER]);
		expect([...(el.svgNeighbors.get(PERSON) ?? [])]).toEqual([ISSUER]);
	});

	it("disambiguates edges whose path id is ambiguous (A_B→C, not A→B_C)", () => {
		// Node ids "A","A_B","B_C","C" make the edge id `L_A_B_C_0` parseable as either A→B_C or A_B→C.
		// Positional drawnEdges fixes the true endpoints; an id-parser would mislink.
		const { el, host } = makeView(["A", "A_B", "B_C", "C"], [["A_B", "C"]]);
		el.bindNodeClicks(host);
		expect([...(el.svgNeighbors.get("A_B") ?? [])]).toEqual(["C"]);
		expect([...(el.svgNeighbors.get("C") ?? [])]).toEqual(["A_B"]);
		expect(el.svgNeighbors.get("A") ?? new Set()).toEqual(new Set()); // not mislinked
		expect(el.svgNeighbors.get("B_C") ?? new Set()).toEqual(new Set());
	});

	it("hover highlights the node + its neighbors, dimming via the .diagram-container (not the inner leaf)", () => {
		const { el, container, host } = makeView([ISSUER, VM, PERSON], [[ISSUER, VM]]);
		el.bindNodeClicks(host);
		el.svgNodeElements.get(ISSUER)?.dispatchEvent(new Event("mouseenter"));
		// The dim/highlight CSS keys off `.diagram-container.filter-highlight`, so the class must land on the container.
		expect(container.classList.contains("filter-highlight")).toBe(true);
		expect(host.classList.contains("filter-highlight")).toBe(false);
		expect(el.svgNodeElements.get(ISSUER)?.classList.contains("filter-match")).toBe(true);
		expect(el.svgNodeElements.get(VM)?.classList.contains("filter-match")).toBe(true);
		expect(el.svgNodeElements.get(PERSON)?.classList.contains("filter-match")).toBe(false);
	});

	it("skips a stale SVG node absent from currentNodeMap rather than binding a desynced click", () => {
		const { el, host } = makeView([ISSUER, VM], [[ISSUER, VM]]); // PERSON not in the map
		// Inject a stale extra node into the SVG.
		const stale = document.createElementNS(SVG_NS, "g");
		stale.setAttribute("id", `mr-5-flowchart-${PERSON}-9`);
		host.querySelector("svg")?.appendChild(stale);
		el.bindNodeClicks(host);
		expect(el.svgNodeElements.has(PERSON)).toBe(false);
		expect(el.svgNodeElements.has(ISSUER)).toBe(true);
	});
});
