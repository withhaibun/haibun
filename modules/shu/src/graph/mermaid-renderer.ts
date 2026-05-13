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
	unreachable: { fill: "#fdd", stroke: "#a02828" },
	refused: { fill: "#fde6c4", stroke: "#b58105" },
	argument: { fill: "#fff7e6", stroke: "#b58105" },
	current: { fill: "#dbeafe", stroke: "#1d3680", strokeWidth: 3 },
	field: { fill: "#f4f0fa", stroke: "#6a4f9a" },
};

/** Mermaid arrow syntax per edge kind. */
const EDGE_ARROW: Record<string, string> = {
	default: "-->",
	ready: "==>",
	blocked: "-->",
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
	return `n_${s.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 60);
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

	// Edges.
	const highlight = options?.highlightedPath;
	for (const e of graph.edges) {
		const dimmed = highlight && e.paths && !e.paths.includes(highlight);
		const arrow = dimmed ? "-.->" : arrowForEdge(e);
		const label = e.label ? `|"${escLabel(e.label)}"|` : "";
		lines.push(`  ${idFor(e.from)} ${arrow}${label} ${idFor(e.to)}`);
	}

	// Styles per node.
	for (const n of graph.nodes) {
		const line = styleLine(idFor(n.id), n.kind, graph.styles);
		if (line) lines.push(line);
	}

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
		const sanitisedIds = new Map<string, string>();
		for (const n of graph.nodes) sanitisedIds.set(sanitiseId(n.id), n.id);

		// Mermaid emits nodes as SVG `<g class="node" id="flowchart-<sanitisedId>-N">`.
		const svgNodes = container.querySelectorAll<SVGGElement>("g.node");
		for (const g of Array.from(svgNodes)) {
			const idAttr = g.id;
			if (!idAttr) continue;
			// Mermaid prefixes `flowchart-` and may suffix `-NN` for repeats.
			const match = idAttr.match(/^flowchart-(.+?)(?:-\d+)?$/);
			if (!match) continue;
			const rawId = sanitisedIds.get(match[1]);
			if (!rawId) continue;
			const node = graph.nodes.find((n) => n.id === rawId);
			if (!node) continue;
			g.style.cursor = "pointer";
			g.addEventListener("click", (e) => {
				e.stopPropagation();
				container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { nodeId: rawId, node }, bubbles: true, composed: true }));
			});
		}
	}
}
