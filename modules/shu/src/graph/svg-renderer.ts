/**
 * SVG paint for a graph: lays the graph out (layered) and emits self-contained SVG markup with group borders, kind
 * colours, edge arrows, and per-node hover-hint titles. `graphToSvg` is pure markup so the same paint runs in a
 * browser component and in a Node report bake; `SvgGraphRenderer` wires node click/hover/leave on the painted DOM.
 */
import { SHU_EVENT } from "../consts.js";
import { layeredLayout, type NodeBox } from "./layered-layout.js";
import { presentationForType } from "./type-presentation.js";
import { xml, truncate, arrowMarker, ARROW_MARKER_ID, SVG_MARGIN as MARGIN } from "./svg-util.js";
import type { IGraphRenderer, TGraph, TGraphEdge, TGraphRenderOptions } from "./types.js";

/** Built-in node styling by `kind`; consumers override via `graph.styles[kind]`. */
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

/** Edge dash by `kind`; blocked/capability-gated dash, ready is bold. */
const EDGE_DASH: Record<string, string> = { blocked: "4 3", "capability-gated": "4 3", context: "6 4" };
const EDGE_WIDTH: Record<string, number> = { ready: 2.5, reply: 2.5 };

function nodeStyle(kind: string | undefined, overrides: TGraph["styles"]): { fill: string; stroke: string; strokeWidth: number } {
	const k = kind ?? "default";
	const o = overrides?.[k];
	const base = NODE_DEFAULTS[k];
	// A built-in workflow kind (satisfied/reachable/…) or an explicit override keeps its styling. Otherwise `kind` is a
	// data @type (buildGraphTopology sets node.kind = the namedGraph): take its fill from the per-@type presenter — the
	// SAME source the 3D paint uses — so SVG and 3D data nodes share colours (one presenter feeds both paints).
	const fill = o?.fill ?? base?.fill ?? presentationForType(k).mark({ id: k, name: k, type: k }, {}).color;
	return { fill, stroke: o?.stroke ?? base?.stroke ?? NODE_DEFAULTS.default.stroke, strokeWidth: o?.strokeWidth ?? base?.strokeWidth ?? 1.5 };
}

/** The point on a box's border on the ray from its centre toward `toward` — so an edge meets the node edge, not its centre. */
function borderPoint(box: NodeBox, toward: { x: number; y: number }): { x: number; y: number } {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if (dx === 0 && dy === 0) return { x: cx, y: cy };
	const s = 1 / Math.max(Math.abs(dx) / (box.w / 2 || 1), Math.abs(dy) / (box.h / 2 || 1));
	return { x: cx + dx * s, y: cy + dy * s };
}

const groupHue = (i: number): string => `hsl(${(i * 67) % 360} 45% 50%)`;

/** Pure SVG markup for a graph (no DOM). Group boxes (outermost first), then edges, then nodes on top. */
export function graphToSvg(graph: TGraph, options?: TGraphRenderOptions): string {
	const layout = layeredLayout(graph);
	const w = layout.width + MARGIN * 2;
	const h = layout.height + MARGIN * 2;
	const shift = (b: NodeBox): NodeBox => ({ x: b.x + MARGIN, y: b.y + MARGIN, w: b.w, h: b.h });
	const centre = (b: NodeBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
	const highlight = options?.highlightedPath;
	const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

	const groups = layout.groups
		.map((g, i) => {
			const col = groupHue(i);
			return `<g class="group" data-group-id="${xml(g.id)}"><rect class="group-box" x="${(g.x + MARGIN).toFixed(1)}" y="${(g.y + MARGIN).toFixed(1)}" width="${g.w.toFixed(1)}" height="${g.h.toFixed(1)}" rx="6" fill="${col}" fill-opacity="0.06" stroke="${col}" stroke-opacity="0.5"/><text class="group-label" x="${(g.x + MARGIN + 6).toFixed(1)}" y="${(g.y + MARGIN + 14).toFixed(1)}" fill="${col}" font-size="11">${xml(g.label)}</text></g>`;
		})
		.join("");

	const edges = graph.edges
		.map((e: TGraphEdge) => {
			const a = layout.nodes.get(e.from);
			const b = layout.nodes.get(e.to);
			if (!a || !b) return "";
			const sa = shift(a);
			const sb = shift(b);
			const p1 = borderPoint(sa, centre(sb));
			const p2 = borderPoint(sb, centre(sa));
			const dimmed = !!(highlight && e.paths && !e.paths.includes(highlight));
			const dash = EDGE_DASH[e.kind ?? ""] ? ` stroke-dasharray="${EDGE_DASH[e.kind ?? ""]}"` : "";
			const sw = EDGE_WIDTH[e.kind ?? ""] ?? 1.5;
			const op = dimmed ? "0.3" : "1";
			const label = e.label
				? `<text class="edge-label" x="${((p1.x + p2.x) / 2).toFixed(1)}" y="${((p1.y + p2.y) / 2 - 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--shu-fg-muted)" opacity="${op}">${xml(truncate(e.label))}</text>`
				: "";
			return `<g class="edge" data-from="${xml(e.from)}" data-to="${xml(e.to)}"${e.rel ? ` data-rel="${xml(e.rel)}"` : ""}><path class="edge-path" d="M${p1.x.toFixed(1)},${p1.y.toFixed(1)} L${p2.x.toFixed(1)},${p2.y.toFixed(1)}" fill="none" stroke="var(--shu-fg-faded)" stroke-width="${sw}"${dash} opacity="${op}" marker-end="url(#${ARROW_MARKER_ID})"/>${label}</g>`;
		})
		.join("");

	const nodes = graph.nodes
		.map((n) => {
			const box = layout.nodes.get(n.id);
			if (!box) return "";
			const s = shift(box);
			const st = nodeStyle(n.kind, graph.styles);
			const hint = n.hint ?? `${n.label}${n.kind ? ` · ${n.kind}` : ""}`;
			return `<g class="node" data-node-id="${xml(n.id)}" style="cursor:pointer"><title>${xml(hint)}</title><rect class="node-box" x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" width="${s.w.toFixed(1)}" height="${s.h.toFixed(1)}" rx="5" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}"/><text class="node-label" x="${(s.x + s.w / 2).toFixed(1)}" y="${(s.y + s.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#222">${xml(truncate(n.label))}</text></g>`;
		})
		.join("");

	void nodeById;
	return `<svg class="shu-graph-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"><defs>${arrowMarker()}</defs><g class="groups">${groups}</g><g class="edges">${edges}</g><g class="nodes">${nodes}</g></svg>`;
}

/** Canonical text for a graph (skip-when-unchanged key + the copy-to-clipboard artifact): Graphviz DOT. */
export function graphToDot(graph: TGraph, options?: TGraphRenderOptions): string {
	const dir = graph.direction ?? "LR";
	const rankdir = dir === "TB" || dir === "BT" ? "TB" : "LR";
	const id = (s: string): string => `"${String(s).replace(/"/g, '\\"')}"`;
	const lines = [`digraph G {`, `  rankdir=${rankdir};`, `  node [shape=box];`];
	const byGroup = new Map<string | undefined, string[]>();
	for (const n of graph.nodes) {
		const b = byGroup.get(n.group);
		if (b) b.push(n.id);
		else byGroup.set(n.group, [n.id]);
	}
	const emitNode = (nid: string, indent: string): void => {
		const n = graph.nodes.find((x) => x.id === nid);
		if (n) lines.push(`${indent}${id(n.id)} [label=${id(n.label)}${n.kind ? `, class=${id(n.kind)}` : ""}];`);
	};
	const childOf = new Map<string | undefined, string[]>();
	for (const [gid, g] of Object.entries(graph.groups ?? {})) {
		const b = childOf.get(g.parent);
		if (b) b.push(gid);
		else childOf.set(g.parent, [gid]);
	}
	const emitGroup = (gid: string, indent: string): void => {
		const g = graph.groups?.[gid];
		if (!g) return;
		lines.push(`${indent}subgraph ${id(`cluster_${gid}`)} {`, `${indent}  label=${id(g.label)};`);
		for (const nid of byGroup.get(gid) ?? []) emitNode(nid, `${indent}  `);
		for (const child of childOf.get(gid) ?? []) emitGroup(child, `${indent}  `);
		lines.push(`${indent}}`);
	};
	for (const nid of byGroup.get(undefined) ?? []) emitNode(nid, "  ");
	for (const gid of childOf.get(undefined) ?? []) emitGroup(gid, "  ");
	for (const e of graph.edges) {
		const dimmed = options?.highlightedPath && e.paths && !e.paths.includes(options.highlightedPath);
		lines.push(`  ${id(e.from)} -> ${id(e.to)} [${e.label ? `label=${id(e.label)}` : ""}${dimmed ? `${e.label ? ", " : ""}style=dashed` : ""}];`);
	}
	lines.push(`}`);
	return lines.join("\n");
}

/** Map raw node id → its `<g class="node">` element in the painted SVG. */
export function findSvgNodes(_graph: TGraph, container: Element): Map<string, SVGGElement> {
	const out = new Map<string, SVGGElement>();
	for (const g of Array.from(container.querySelectorAll<SVGGElement>("g.node[data-node-id]"))) {
		const id = g.getAttribute("data-node-id");
		if (id) out.set(id, g);
	}
	return out;
}

/** Map raw node id → the set of edge `<g>` elements incident to it. */
export function findSvgEdges(_graph: TGraph, container: Element): Map<string, Set<Element>> {
	const out = new Map<string, Set<Element>>();
	const add = (id: string, el: Element): void => {
		const set = out.get(id) ?? new Set<Element>();
		set.add(el);
		out.set(id, set);
	};
	for (const g of Array.from(container.querySelectorAll("g.edge"))) {
		const from = g.getAttribute("data-from");
		const to = g.getAttribute("data-to");
		if (from) add(from, g);
		if (to) add(to, g);
	}
	return out;
}

export class SvgGraphRenderer implements IGraphRenderer {
	render(graph: TGraph, container: HTMLElement, options?: TGraphRenderOptions): Promise<void> {
		container.innerHTML = graphToSvg(graph, options);
		const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
		for (const [rawId, element] of findSvgNodes(graph, container)) {
			const node = nodeById.get(rawId);
			if (!node) continue;
			const detail = { nodeId: rawId, node, element };
			element.addEventListener("click", (e) => {
				e.stopPropagation();
				container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail, bubbles: true, composed: true }));
			});
			element.addEventListener("mouseenter", () => container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_HOVER, { detail, bubbles: true, composed: true })));
			element.addEventListener("mouseleave", () => container.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_LEAVE, { detail, bubbles: true, composed: true })));
		}
		return Promise.resolve();
	}
}
