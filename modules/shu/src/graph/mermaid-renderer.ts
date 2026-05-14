import mermaid from "mermaid";

import { SHU_EVENT } from "../consts.js";
import type { IGraphRenderer, TGraph, TGraphEdge, TGraphNode, TGraphRenderOptions } from "./types.js";

/**
 * Built-in styling vocabulary. Consumers override via `graph.styles` keyed by
 * `kind`. Both node and edge kinds share the namespace; the renderer applies
 * fill/stroke to nodes and chooses arrow style for edges.
 */
const NODE_DEFAULTS: Record<string, { fill: string; stroke: string; strokeWidth?: number }> = {
	default: { fill: "#eee", stroke: "#999" },
	satisfied: { fill: "#d8edd8", stroke: "#1a6b3c", strokeWidth: 2 },
	reachable: { fill: "#d8e1f0", stroke: "#2848a8" },
	refused: { fill: "#fde6c4", stroke: "#b58105" },
	unreachable: { fill: "#fdd", stroke: "#a02828" },
	current: { fill: "#fde68a", stroke: "#a16207", strokeWidth: 4 },
	field: { fill: "#f4f0fa", stroke: "#6a4f9a" },
	"fact-instance": { fill: "#ecfdf5", stroke: "#1a6b3c" },
	"waypoint-ensured": { fill: "#d8edd8", stroke: "#1a6b3c", strokeWidth: 2 },
	"waypoint-declarative": { fill: "#fde6c4", stroke: "#b58105" },
	"waypoint-imperative": { fill: "#fde6c4", stroke: "#b58105" },
};

/** Mermaid arrow syntax per edge kind. Blocked and capability-gated share the
 * dashed style; the capability requirement is signalled by the lock glyph on
 * the label, not by a separate arrow style. */
const EDGE_ARROW: Record<string, string> = {
	default: "-->",
	ready: "==>",
	blocked: "-.->",
	"capability-gated": "-.->",
};

/** Escape Mermaid special chars in labels (mirrors mermaid-source.ts: esc). Strips chars that would break label parsing; use only on label text, never on whole source. */
export function escLabel(s: string): string {
	return String(s)
		.replace(/"/g, "#quot;")
		.replace(/[[\](){}|<>]/g, " ");
}

/** HTML-escape for safely embedding a string inside `<pre>` / `<div>` content. */
function escHtml(s: string): string {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitise an id for Mermaid. Mermaid v11's lexer reserves several leading
 * tokens (`graph`, `flowchart`, `subgraph`, `end`, `direction`, `class`,
 * `click`, `style`, `linkStyle`, `classDef`, `default`). An id like
 * `graph-vertex-with-edges` matches the `graph` keyword at lex time and
 * breaks the parse. Prefix every sanitised id with `n_` so it never collides
 * with a reserved word, and remap non-id characters to `_`.
 */
export function sanitiseId(s: string): string {
	// Mermaid normalises hyphens to underscores in its emitted SVG ids; collapse them
	// up-front so the source and the rendered SVG share one canonical form. Without
	// this the reverse-lookup in `bindNodeClicks` cannot match hyphenated raw ids.
	return `n_${s.replace(/[^a-zA-Z0-9_]/g, "_")}`.slice(0, 60);
}

function arrowForEdge(edge: TGraphEdge): string {
	return EDGE_ARROW[edge.kind ?? "default"] ?? EDGE_ARROW.default;
}

function styleLine(nodeId: string, kind: string | undefined, overrides: TGraph["styles"]): string | undefined {
	const k = kind ?? "default";
	const override = overrides?.[k];
	const fallback = NODE_DEFAULTS[k];
	const merged = { ...fallback, ...override };
	if (!merged.fill && !merged.stroke) return undefined;
	const parts: string[] = [];
	if (merged.fill) parts.push(`fill:${merged.fill}`);
	if (merged.stroke) parts.push(`stroke:${merged.stroke}`);
	if (merged.strokeWidth) parts.push(`stroke-width:${merged.strokeWidth}px`);
	return `  style ${nodeId} ${parts.join(",")}`;
}

/**
 * Build Mermaid source from a renderer-agnostic graph shape. Pure function; no
 * DOM access. Tests can snapshot the output.
 *
 * Nodes are grouped into Mermaid `subgraph` blocks when `node.group` references
 * an entry in `graph.groups`. Ungrouped nodes are emitted at the top level.
 * `node.kind` and `edge.kind` drive styling via the built-in vocabulary and
 * `graph.styles` overrides.
 *
 * When `options.highlightedPath` is set, edges whose `paths` include that path
 * id render with their normal arrow; edges that participate in other paths only
 * render dimmed. Edges with no `paths` field render normally regardless.
 */
export function buildMermaidSource(graph: TGraph, options?: TGraphRenderOptions): string {
	const direction = graph.direction ?? "LR";
	const lines: string[] = [`graph ${direction}`];

	const sanitisedIds = new Map<string, string>();
	const idFor = (rawId: string): string => {
		let id = sanitisedIds.get(rawId);
		if (id === undefined) {
			id = sanitiseId(rawId);
			sanitisedIds.set(rawId, id);
		}
		return id;
	};

	// Group nodes for subgraph emission.
	const nodesByGroup = new Map<string | undefined, TGraphNode[]>();
	for (const n of graph.nodes) {
		const key = n.group;
		let bucket = nodesByGroup.get(key);
		if (!bucket) {
			bucket = [];
			nodesByGroup.set(key, bucket);
		}
		bucket.push(n);
	}

	const emitNode = (n: TGraphNode, indent: string) => {
		lines.push(`${indent}${idFor(n.id)}["${escLabel(n.label)}"]`);
	};

	// Build a parent → children map so nested groups can recurse.
	const childGroups = new Map<string | undefined, string[]>();
	for (const [gid, g] of Object.entries(graph.groups ?? {})) {
		const parent = g.parent;
		let bucket = childGroups.get(parent);
		if (!bucket) {
			bucket = [];
			childGroups.set(parent, bucket);
		}
		bucket.push(gid);
	}

	const emitGroup = (groupId: string, indent: string) => {
		const g = graph.groups?.[groupId];
		if (!g) return;
		lines.push(`${indent}subgraph ${sanitiseId(groupId)}["${escLabel(g.label)}"]`);
		const inner = `${indent}  `;
		for (const n of nodesByGroup.get(groupId) ?? []) emitNode(n, inner);
		for (const child of childGroups.get(groupId) ?? []) emitGroup(child, inner);
		lines.push(`${indent}end`);
	};

	// Top-level: ungrouped nodes, then top-level groups.
	for (const n of nodesByGroup.get(undefined) ?? []) emitNode(n, "  ");
	for (const gid of childGroups.get(undefined) ?? []) emitGroup(gid, "  ");

	// Edges. Track which edge indices are "active" — participating in at least one
	// goal-resolver path — so we can apply a distinct linkStyle per index. Mermaid
	// numbers edges in source order, so the index here matches the rendered svg.
	const highlight = options?.highlightedPath;
	const activeEdgeIndices: number[] = [];
	graph.edges.forEach((e, i) => {
		const dimmed = highlight && e.paths && !e.paths.includes(highlight);
		const arrow = dimmed ? "-.->" : arrowForEdge(e);
		const label = e.label ? `|"${escLabel(e.label)}"|` : "";
		lines.push(`  ${idFor(e.from)} ${arrow}${label} ${idFor(e.to)}`);
		if (!dimmed && (e.paths?.length ?? 0) > 0) activeEdgeIndices.push(i);
	});

	// Styles per node.
	for (const n of graph.nodes) {
		const line = styleLine(idFor(n.id), n.kind, graph.styles);
		if (line) lines.push(line);
	}

	// Active-edge style: edges tagged with one or more goal-resolver paths render
	// in amber so the user can see which steps a goal currently routes through.
	// Potential edges (no path traversal yet) keep their kind-based default style.
	if (activeEdgeIndices.length > 0) lines.push(`  linkStyle ${activeEdgeIndices.join(",")} stroke:#a16207,stroke-width:2px`);

	return lines.join("\n");
}

let mermaidInitialised = false;
let renderCounter = 0;

function ensureMermaidInitialised(): void {
	if (mermaidInitialised) return;
	mermaid.initialize({
		startOnLoad: false,
		theme: "default",
		securityLevel: "loose",
		fontFamily: "ui-sans-serif, system-ui, sans-serif",
		maxTextSize: 1_000_000,
		maxEdges: 5000,
		flowchart: { htmlLabels: true },
	});
	mermaidInitialised = true;
}

/**
 * Renderer that paints the graph as Mermaid-rendered SVG. The container's
 * contents are replaced on each render. Node-click is wired so each node's
 * SVG element dispatches `graph-node-click` on the container with the node's
 * payload.
 */
export class MermaidGraphRenderer implements IGraphRenderer {
	async render(graph: TGraph, container: HTMLElement, options?: TGraphRenderOptions): Promise<void> {
		ensureMermaidInitialised();
		const source = buildMermaidSource(graph, options);
		const id = `shu-graph-${++renderCounter}`;
		try {
			const { svg } = await mermaid.render(id, source);
			container.innerHTML = svg;
			this.wireNodeClicks(graph, container);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			container.innerHTML = `<div class="error">graph render failed: ${escHtml(msg)}</div><pre>${escHtml(source)}</pre>`;
		}
	}

	private wireNodeClicks(graph: TGraph, container: HTMLElement): void {
		const sanitisedToRaw = new Map<string, string>();
		for (const n of graph.nodes) sanitisedToRaw.set(sanitiseId(n.id), n.id);
		// Match the chain-view's prior selector + id-parsing logic verbatim. Using
		// `g[id]` (not just `g.node`) catches every node mermaid emits regardless of
		// class. Using `getAttribute("id")` + `indexOf("flowchart-")` (anywhere in the
		// id, not start-anchored) handles mermaid v11's occasional nested-prefix
		// emissions (e.g. `shu-graph-3-flowchart-vc-22`). The strict `^flowchart-`
		// regex was missing real nodes whose svg id was prefixed by the render id.
		for (const g of Array.from(container.querySelectorAll<SVGGElement>("g[id]"))) {
			const idAttr = g.getAttribute("id") ?? "";
			const idx = idAttr.indexOf("flowchart-");
			if (idx < 0) continue;
			const rawSvgId = idAttr.slice(idx + "flowchart-".length).replace(/-\d+$/, "");
			const rawId = sanitisedToRaw.get(rawSvgId);
			if (!rawId) continue;
			const node = graph.nodes.find((n) => n.id === rawId);
			if (!node) continue;
			g.style.cursor = "pointer";
			g.addEventListener("click", (e) => {
				e.stopPropagation();
				container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { nodeId: rawId, node }, bubbles: true, composed: true }));
			});
			g.addEventListener("mouseenter", () => {
				container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_HOVER, { detail: { nodeId: rawId, node, element: g }, bubbles: true, composed: true }));
			});
			g.addEventListener("mouseleave", () => {
				container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_LEAVE, { detail: { nodeId: rawId, node, element: g }, bubbles: true, composed: true }));
			});
		}
	}
}

/**
 * Reverse-lookup map from raw node id to SVG `<g.node>` element. Both the
 * renderer (for emit) and consumers (for selection / highlight overlays) need
 * this map, so it's a free function that runs over the painted container.
 *
 * Mermaid sanitises ids via `sanitiseId` and may suffix `-NN` for repeats;
 * this function inverts that to find each raw id's SVG element.
 */
export function findSvgNodes(graph: TGraph, container: Element): Map<string, SVGGElement> {
	const sanitisedToRaw = new Map<string, string>();
	for (const n of graph.nodes) sanitisedToRaw.set(sanitiseId(n.id), n.id);
	const out = new Map<string, SVGGElement>();
	for (const g of Array.from(container.querySelectorAll<SVGGElement>("g[id]"))) {
		const idAttr = g.getAttribute("id") ?? "";
		const idx = idAttr.indexOf("flowchart-");
		if (idx < 0) continue;
		const rawSvgId = idAttr.slice(idx + "flowchart-".length).replace(/-\d+$/, "");
		const rawId = sanitisedToRaw.get(rawSvgId);
		if (rawId) out.set(rawId, g);
	}
	return out;
}

/**
 * Build a map from raw node id to the set of SVG path + edge-label elements
 * that connect to that node. Used by hover / selection highlight overlays so
 * consumers don't re-walk the SVG on every event.
 *
 * Mermaid v11 emits edges as `path.flowchart-link` with id pattern
 * `L_<fromSanitised>_<toSanitised>_<idx>`; edge labels in `.edgeLabels > .edgeLabel`
 * are paired by position. Both are bucketed under both endpoints.
 */
export function findSvgEdges(graph: TGraph, container: Element): Map<string, Set<Element>> {
	const sanitisedIds = new Map<string, string>();
	for (const n of graph.nodes) sanitisedIds.set(sanitiseId(n.id), n.id);
	const out = new Map<string, Set<Element>>();
	const add = (rawId: string, el: Element): void => {
		const set = out.get(rawId) ?? new Set<Element>();
		set.add(el);
		out.set(rawId, set);
	};
	const edgePaths = Array.from(container.querySelectorAll("path.flowchart-link"));
	const edgeLabels = Array.from(container.querySelectorAll(".edgeLabels > .edgeLabel"));
	for (let i = 0; i < edgePaths.length; i++) {
		const path = edgePaths[i];
		const label = edgeLabels[i];
		const pid = path.getAttribute("id") ?? "";
		const lIdx = pid.indexOf("-L_");
		if (lIdx < 0) continue;
		const body = pid.slice(lIdx + 3, pid.lastIndexOf("_"));
		for (let j = 1; j < body.length; j++) {
			if (body[j] !== "_") continue;
			const from = sanitisedIds.get(body.slice(0, j));
			const to = sanitisedIds.get(body.slice(j + 1));
			if (!from || !to) continue;
			for (const nid of [from, to]) {
				add(nid, path);
				if (label) add(nid, label);
			}
			break;
		}
	}
	return out;
}
