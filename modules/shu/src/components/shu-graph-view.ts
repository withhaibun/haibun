/**
 * <shu-graph-view> — Renders all quads as a mermaid graph with subgraphs by namedGraph.
 *
 * Shows the unified quad/graph view: variables, observations, vertices, annotations
 * all in one diagram. Named graphs become subgraph clusters. Cross-graph edges visible.
 *
 * Data comes from MonitorStepper-getQuads RPC + live SSE quad observation events.
 */
import { z } from "zod";
import mermaid from "mermaid";
import { ShuElement } from "./shu-element.js";
import { SseClient } from "../sse-client.js";
import { SHU_EVENT } from "../consts.js";
import { openQuadDetailPane } from "../quad-detail-pane.js";
import { getEdgeRanges, getRels } from "../rels-cache.js";
import { LinkRelations } from "@haibun/core/lib/defs.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";

let mermaidInitialized = false;

const DEFAULT_MAX_PER_SUBGRAPH = 20;

const StateSchema = z.object({
	quads: z
		.array(
			z.object({
				subject: z.string(),
				predicate: z.string(),
				object: z.unknown(),
				namedGraph: z.string(),
				timestamp: z.number(),
				properties: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.default([]),
	zoom: z.number().default(100),
	layout: z.enum(["TD", "LR"]).default("TD"),
	hiddenGraphs: z.array(z.string()).default([]),
	expandedGraphs: z.array(z.string()).default([]),
	maxPerSubgraph: z.number().default(DEFAULT_MAX_PER_SUBGRAPH),
});

/** Escape mermaid special chars in labels */
function esc(s: string): string {
	return String(s)
		.replace(/"/g, "#quot;")
		.replace(/[[\](){}|<>]/g, " ");
}

function sanitizeId(s: string): string {
	return s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}

function truncate(s: string, max = 30): string {
	const str = esc(String(s));
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

type TPropKind = "name" | "identifier" | "edge" | "content" | "internal" | "scalar";
const EDGE_RELS: Set<string> = new Set([LinkRelations.ATTRIBUTED_TO.rel, LinkRelations.AUDIENCE.rel, LinkRelations.IN_REPLY_TO.rel, LinkRelations.ATTACHMENT.rel]);

/** Classify properties by their AS2 rel */
function classifyProperty(graph: string, predicate: string): TPropKind {
	if (predicate.startsWith("_")) return "internal";
	const edges = getEdgeRanges(graph);
	if (edges?.[predicate]) return "edge";
	const rels = getRels(graph);
	const rel = rels?.[predicate];
	if (!rel) return "scalar";
	if (rel === LinkRelations.NAME.rel) return "name";
	if (rel === LinkRelations.IDENTIFIER.rel) return "identifier";
	if (rel === LinkRelations.CONTENT.rel) return "content";
	if (EDGE_RELS.has(rel)) return "edge";
	return "scalar";
}

type TGraphViewOpts = { layout: "TD" | "LR"; hiddenGraphs: Set<string>; expandedGraphs: Set<string>; maxPerSubgraph: number };
type TBuildResult = { source: string; nodeMap: Map<string, { graph: string; subject: string }> };

function buildMermaidSource(quads: TQuad[], opts: TGraphViewOpts): TBuildResult {
	const { layout, hiddenGraphs, expandedGraphs, maxPerSubgraph } = opts;
	const visible = quads.filter((q) => !hiddenGraphs.has(q.namedGraph));
	const entityIds = new Set(visible.map((q) => q.subject));

	// Group quads by named graph, then by subject
	const byGraph = new Map<string, Map<string, TQuad[]>>();
	for (const q of visible) {
		let graphMap = byGraph.get(q.namedGraph);
		if (!graphMap) {
			graphMap = new Map();
			byGraph.set(q.namedGraph, graphMap);
		}
		let subjectQuads = graphMap.get(q.subject);
		if (!subjectQuads) {
			subjectQuads = [];
			graphMap.set(q.subject, subjectQuads);
		}
		subjectQuads.push(q);
	}

	const lines: string[] = [`graph ${layout}`];
	const nodeIds = new Set<string>();
	const nodeMap = new Map<string, { graph: string; subject: string }>();
	const edges: string[] = [];

	for (const [graph, subjects] of byGraph) {
		const graphId = sanitizeId(graph);
		const total = subjects.size;
		const expanded = expandedGraphs.has(graph);
		const collapsed = !expanded && total > maxPerSubgraph;

		if (collapsed) {
			// Render as a single summary node — clickable to expand
			const summaryId = sanitizeId(`${graph}__summary`);
			nodeIds.add(summaryId);
			lines.push(`  subgraph ${graphId}["${esc(graph)}"]`);
			lines.push(`    ${summaryId}[["${esc(graph)}\n${total} items"]]`);
			lines.push("  end");

			// Still emit edges FROM collapsed nodes to visible nodes using the summary as source
			for (const [subject, subjectQuads] of subjects) {
				for (const q of subjectQuads) {
					if (typeof q.object !== "string" || classifyProperty(graph, q.predicate) !== "edge") continue;
					if (!entityIds.has(q.object) || q.object === subject) continue;
					const targetGraph = visible.find((v) => v.subject === q.object)?.namedGraph ?? graph;
					if (hiddenGraphs.has(targetGraph)) continue;
					const targetSubjects = byGraph.get(targetGraph);
					const targetCollapsed = targetSubjects && !expandedGraphs.has(targetGraph) && targetSubjects.size > maxPerSubgraph;
					const targetId = targetCollapsed ? sanitizeId(`${targetGraph}__summary`) : sanitizeId(`${targetGraph}_${q.object}`);
					if (!edges.some((e) => e.includes(`${summaryId} -->`) && e.includes(targetId))) {
						edges.push(`  ${summaryId} -->|${truncate(q.predicate, 15)}| ${targetId}`);
					}
				}
			}
			continue;
		}

		lines.push(`  subgraph ${graphId}["${esc(graph)} (${total})"]`);

		for (const [subject, subjectQuads] of subjects) {
			const nodeId = sanitizeId(`${graph}_${subject}`);
			nodeIds.add(nodeId);
			nodeMap.set(nodeId, { graph, subject });

			const nameQuad = subjectQuads.find((q) => classifyProperty(graph, q.predicate) === "name");
			const displayName = nameQuad ? truncate(String(nameQuad.object), 30) : truncate(subject, 25);

			const contentQuad = subjectQuads.find((q) => classifyProperty(graph, q.predicate) === "content");
			const contentStr = contentQuad ? `\n${truncate(String(contentQuad.object), 40)}` : "";

			const props: string[] = [];
			for (const q of subjectQuads) {
				if (classifyProperty(graph, q.predicate) !== "scalar") continue;
				props.push(`${esc(q.predicate)}: ${truncate(String(q.object), 25)}`);
				if (props.length >= 3) break;
			}

			const propsStr = props.length > 0 ? `\n${props.join("\n")}` : "";
			lines.push(`    ${nodeId}["${displayName}${contentStr}${propsStr}"]`);

			for (const q of subjectQuads) {
				if (typeof q.object !== "string" || classifyProperty(graph, q.predicate) !== "edge") continue;
				if (!entityIds.has(q.object) || q.object === subject) continue;
				const targetGraph = visible.find((v) => v.subject === q.object)?.namedGraph ?? graph;
				if (hiddenGraphs.has(targetGraph)) continue;
				const targetSubjects = byGraph.get(targetGraph);
				const targetCollapsed = targetSubjects && !expandedGraphs.has(targetGraph) && targetSubjects.size > maxPerSubgraph;
				const targetId = targetCollapsed ? sanitizeId(`${targetGraph}__summary`) : sanitizeId(`${targetGraph}_${q.object}`);
				const edgeLine = `  ${nodeId} -->|${truncate(q.predicate, 15)}| ${targetId}`;
				// Deduplicate edges to collapsed targets (one per predicate type)
				if (targetCollapsed) {
					if (!edges.some((e) => e.includes(`${nodeId} -->`) && e.includes(targetId) && e.includes(q.predicate))) edges.push(edgeLine);
				} else {
					edges.push(edgeLine);
				}
			}
		}

		lines.push("  end");
	}

	lines.push(...edges);
	return { source: lines.join("\n"), nodeMap };
}

const STYLES = `
:host { display: block; overflow: auto; }
.toolbar { display: flex; gap: 4px; align-items: center; padding: 4px 8px; border-bottom: 1px solid #ddd; flex-wrap: wrap; }
.toolbar button { padding: 2px 8px; cursor: pointer; }
.toolbar label { font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.diagram-container { overflow: auto; padding: 8px; }
.diagram-container .node rect, .diagram-container .node polygon { cursor: pointer; }
.diagram-container .nodeLabel { text-align: left !important; }
.zoom-label { color: #666; }
.quad-count { color: #888; margin-left: auto; }
.empty { padding: 16px; color: #888; text-align: center; }
.graph-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-left: 8px; }
`;

export class ShuGraphView extends ShuElement<typeof StateSchema> {
	private diagramId = `shu-graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	private unsubscribe?: () => void;
	private currentNodeMap = new Map<string, { graph: string; subject: string }>();

	constructor() {
		super(StateSchema, { quads: [], zoom: 100, layout: "TD", hiddenGraphs: [], expandedGraphs: [], maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH });
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");

		try {
			const data = await client.rpc<{ quads: TQuad[] }>("MonitorStepper-getQuads");
			if (data.quads?.length) this.setState({ quads: data.quads });
		} catch {
			/* stepper may not be loaded */
		}

		this.unsubscribe = client.onEvent((event) => {
			const e = event as { kind?: string; artifactType?: string; json?: { quadObservation?: TQuad } };
			if (e.kind === "artifact" && e.artifactType === "json" && e.json?.quadObservation) {
				const q = e.json.quadObservation;
				if (q.subject && q.predicate && q.namedGraph) {
					this.setState({ quads: [...this.state.quads, { ...q, timestamp: q.timestamp ?? Date.now() }] });
				}
			}
		});
	}

	disconnectedCallback(): void {
		this.unsubscribe?.();
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		const { quads, zoom, layout, hiddenGraphs, maxPerSubgraph } = this.state;

		if (quads.length === 0) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty"><shu-spinner></shu-spinner> Loading graph data...</div>`;
			return;
		}

		const graphs = [...new Set(quads.map((q) => q.namedGraph))].sort();
		const hiddenSet = new Set(hiddenGraphs);

		const filterHtml = graphs.map((g) => `<label><input type="checkbox" data-graph="${g}" ${hiddenSet.has(g) ? "" : "checked"}> ${g}</label>`).join("");

		this.shadowRoot.innerHTML = `${this.css(STYLES)}
			<div class="toolbar" data-testid="graph-view-toolbar">
				<button data-action="layout">${layout}</button>
				<button data-action="zoom-out">\u2212</button>
				<span class="zoom-label">${zoom}%</span>
				<button data-action="zoom-in">+</button>
				<button data-action="copy">Copy</button>
				<label>limit <input type="number" data-action="max" value="${maxPerSubgraph}" min="1" max="999" style="width:40px"></label>
				<div class="graph-filters">${filterHtml}</div>
				<span class="quad-count">${quads.length} quads</span>
			</div>
			<div class="diagram-container" style="transform: scale(${zoom / 100}); transform-origin: top left;">
				<div id="${this.diagramId}"></div>
			</div>`;

		this.bindToolbar();
		void this.renderMermaid();
	}

	private bindToolbar(): void {
		this.shadowRoot?.querySelectorAll("[data-action]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const action = (btn as HTMLElement).dataset.action;
				if (action === "zoom-in") this.setState({ zoom: Math.min(200, this.state.zoom + 10) });
				else if (action === "zoom-out") this.setState({ zoom: Math.max(10, this.state.zoom - 10) });
				else if (action === "layout") this.setState({ layout: this.state.layout === "TD" ? "LR" : "TD" });
				else if (action === "copy") navigator.clipboard.writeText(buildMermaidSource(this.state.quads, this.buildOpts()).source);
			});
		});
		this.shadowRoot?.querySelectorAll("input[data-graph]").forEach((cb) => {
			cb.addEventListener("change", () => {
				const graph = (cb as HTMLInputElement).dataset.graph ?? "";
				const checked = (cb as HTMLInputElement).checked;
				const hidden = new Set(this.state.hiddenGraphs);
				if (checked) hidden.delete(graph);
				else hidden.add(graph);
				this.setState({ hiddenGraphs: [...hidden] });
			});
		});
		const maxInput = this.shadowRoot?.querySelector("input[data-action='max']") as HTMLInputElement | null;
		maxInput?.addEventListener("change", () => {
			const val = parseInt(maxInput.value, 10);
			if (val > 0) this.setState({ maxPerSubgraph: val });
		});
	}

	private buildOpts(): TGraphViewOpts {
		return {
			layout: this.state.layout,
			hiddenGraphs: new Set(this.state.hiddenGraphs),
			expandedGraphs: new Set(this.state.expandedGraphs),
			maxPerSubgraph: this.state.maxPerSubgraph,
		};
	}

	private async renderMermaid(): Promise<void> {
		if (!mermaidInitialized) {
			mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose", fontFamily: "ui-sans-serif, system-ui, sans-serif", maxTextSize: 200000 });
			mermaidInitialized = true;
		}
		const { source, nodeMap } = buildMermaidSource(this.state.quads, this.buildOpts());
		this.currentNodeMap = nodeMap;
		try {
			const { svg } = await mermaid.render(this.diagramId, source);
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) {
				container.innerHTML = `<div>${svg}</div>`;
				// Debug: log all elements with IDs in the SVG
				const allIds = container.querySelectorAll("[id]");
				console.debug(
					"[graph-view] SVG ids:",
					Array.from(allIds)
						.slice(0, 10)
						.map((el) => `${el.tagName}#${el.id}`),
				);
				this.bindNodeClicks(container);
			}
		} catch (err) {
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<pre style="color:red">${err instanceof Error ? err.message : err}</pre>`;
		}
	}

	/** Make nodes clickable by querying the rendered SVG for g elements with flowchart node IDs */
	private bindNodeClicks(container: Element): void {
		const svg = container.querySelector("svg");
		if (!svg) return;
		let bound = 0;
		svg.querySelectorAll("g[id]").forEach((g) => {
			const id = g.getAttribute("id") ?? "";
			const flowchartIdx = id.indexOf("flowchart-");
			if (flowchartIdx < 0) return;
			const rawId = id.slice(flowchartIdx + "flowchart-".length).replace(/-\d+$/, "");
			if (!rawId || (!this.currentNodeMap.has(rawId) && !rawId.endsWith("__summary"))) return;
			(g as SVGGElement).style.cursor = "pointer";
			g.addEventListener("click", (e) => {
				e.stopPropagation();
				if (rawId.endsWith("__summary")) {
					this.setState({ expandedGraphs: [...new Set([...this.state.expandedGraphs, rawId.slice(0, -9)])] });
					return;
				}
				const entry = this.currentNodeMap.get(rawId);
				if (!entry) return;
				if (getRels(entry.graph)) {
					this.dispatchEvent(new CustomEvent(SHU_EVENT.COLUMN_OPEN, { detail: { label: entry.graph, subject: entry.subject }, bubbles: true, composed: true }));
				} else {
					this.showQuadDetail(entry.graph, entry.subject);
				}
			});
			bound++;
		});
		console.debug("[graph-view] bound", bound, "clickable nodes");
	}

	private showQuadDetail(graph: string, subject: string): void {
		openQuadDetailPane(
			graph,
			subject,
			this.state.quads.filter((q) => q.subject === subject && q.namedGraph === graph),
			this,
		);
	}
}
