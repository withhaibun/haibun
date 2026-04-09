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
import { getEdgeRanges, getEdgeRelMap, getRels } from "../rels-cache.js";
import { getAvailableSteps, getStepperForType } from "../rpc-registry.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { buildMermaidSource, buildClassifier, DEFAULT_MAX_PER_SUBGRAPH, type TGraphViewOpts } from "../mermaid-source.js";

let mermaidInitialized = false;

const browserClassifier = buildClassifier(getRels, getEdgeRanges, getStepperForType, undefined);
browserClassifier.relForEdge = (_graph: string, predicate: string) => getEdgeRelMap()[predicate];

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

const STYLES = `
:host { display: block; overflow: auto; }
.toolbar { display: flex; gap: 4px; align-items: center; padding: 4px 8px; border-bottom: 1px solid #ddd; flex-wrap: wrap; }
.toolbar button { padding: 2px 8px; cursor: pointer; }
.toolbar label { font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.diagram-container { overflow: auto; padding: 8px; }
.diagram-container .node rect, .diagram-container .node polygon { cursor: pointer; }
.diagram-container .nodeLabel { text-align: left !important; }
.diagram-container.hovering .node { opacity: 0.15; transition: opacity 0.15s; }
.diagram-container.hovering .node.neighbor { opacity: 1; transition: opacity 0.15s; }
.diagram-container .node { transition: opacity 0.15s; }
.diagram-container path.edge-pattern-dotted { stroke-dasharray: 8 4 !important; stroke-width: 1.5px !important; opacity: 0.7; }
.zoom-label { color: #666; }
.quad-count { color: #888; margin-left: auto; }
.empty { padding: 16px; color: #888; text-align: center; }
.graph-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-left: 8px; }
`;

const HIDDEN_GRAPHS_COOKIE = "shu-graph-hidden";

function readHiddenGraphsCookie(): string[] {
	const match = document.cookie.match(new RegExp(`(?:^|; )${HIDDEN_GRAPHS_COOKIE}=([^;]*)`));
	if (!match) return [];
	try {
		return JSON.parse(decodeURIComponent(match[1]));
	} catch {
		return [];
	}
}

function writeHiddenGraphsCookie(hidden: string[]): void {
	document.cookie = `${HIDDEN_GRAPHS_COOKIE}=${encodeURIComponent(JSON.stringify(hidden))}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

export class ShuGraphView extends ShuElement<typeof StateSchema> {
	private diagramId = `shu-graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	private unsubscribe?: () => void;
	private currentNodeMap = new Map<string, { graph: string; subject: string }>();
	private visibleQuads: TQuad[] = [];
	private lastMermaidSource = "";

	constructor() {
		super(StateSchema, {
			quads: [],
			zoom: 100,
			layout: "TD",
			hiddenGraphs: readHiddenGraphsCookie(),
			expandedGraphs: [],
			maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH,
		});
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		const client = SseClient.for("");

		// Ensure rels-cache is populated so classifyProperty can identify edges
		await getAvailableSteps();

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

	private lastTimeSyncRender = 0;
	private timeSyncTimer = 0;

	protected override onTimeSync(): void {
		// Throttle: render at most every 500ms during continuous play
		const now = Date.now();
		if (now - this.lastTimeSyncRender >= 500) {
			this.lastTimeSyncRender = now;
			this.visibleQuads = this.filterByTime(this.state.quads);
			void this.renderMermaid();
		} else if (!this.timeSyncTimer) {
			this.timeSyncTimer = window.setTimeout(() => {
				this.timeSyncTimer = 0;
				this.lastTimeSyncRender = Date.now();
				this.visibleQuads = this.filterByTime(this.state.quads);
				void this.renderMermaid();
			}, 500);
		}
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

		// Filter quads by time cursor — show graph state at that moment
		this.visibleQuads = this.filterByTime(quads);
		const visibleQuads = this.visibleQuads;
		const graphs = [...new Set(visibleQuads.map((q) => q.namedGraph))].sort();
		const hiddenSet = new Set(hiddenGraphs);

		const filterHtml = graphs.map((g) => `<label><input type="checkbox" data-graph="${g}" ${hiddenSet.has(g) ? "" : "checked"}> ${g}</label>`).join("");

		this.lastMermaidSource = "";
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
				else if (action === "copy") navigator.clipboard.writeText(buildMermaidSource(this.visibleQuads, this.buildOpts(), browserClassifier).source);
			});
		});
		this.shadowRoot?.querySelectorAll("input[data-graph]").forEach((cb) => {
			cb.addEventListener("change", () => {
				const graph = (cb as HTMLInputElement).dataset.graph ?? "";
				const checked = (cb as HTMLInputElement).checked;
				const hidden = new Set(this.state.hiddenGraphs);
				if (checked) hidden.delete(graph);
				else hidden.add(graph);
				const hiddenArray = [...hidden];
				writeHiddenGraphsCookie(hiddenArray);
				this.setState({ hiddenGraphs: hiddenArray });
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
			mermaid.initialize({
				startOnLoad: false,
				theme: "default",
				securityLevel: "loose",
				fontFamily: "ui-sans-serif, system-ui, sans-serif",
				maxTextSize: 200000,
			});
			mermaidInitialized = true;
		}
		const { source, nodeMap } = buildMermaidSource(this.visibleQuads, this.buildOpts(), browserClassifier);
		if (source === this.lastMermaidSource) return;
		this.lastMermaidSource = source;
		this.currentNodeMap = nodeMap;
		try {
			const { svg } = await mermaid.render(this.diagramId, source);
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) {
				const scrollTop = container.scrollTop;
				const scrollLeft = container.scrollLeft;
				container.innerHTML = `<div>${svg}</div>`;
				container.scrollTop = scrollTop;
				container.scrollLeft = scrollLeft;
				this.bindNodeClicks(container);
			}
		} catch (err) {
			const container = this.shadowRoot?.querySelector(".diagram-container");
			if (container) container.innerHTML = `<pre style="color:red">${err instanceof Error ? err.message : err}</pre>`;
		}
	}

	/** Make nodes clickable; highlight node + its neighbors + connecting edges on hover. */
	private bindNodeClicks(container: Element): void {
		const svg = container.querySelector("svg");
		if (!svg) return;

		// Pass 1: collect node rawIds
		const nodeElements = new Map<string, Element>();
		const allNodeIds = new Set<string>();
		svg.querySelectorAll("g[id]").forEach((g) => {
			const id = g.getAttribute("id") ?? "";
			const idx = id.indexOf("flowchart-");
			if (idx < 0) return;
			const rawId = id.slice(idx + "flowchart-".length).replace(/-\d+$/, "");
			if (rawId && (this.currentNodeMap.has(rawId) || rawId.endsWith("__summary"))) {
				nodeElements.set(rawId, g);
				allNodeIds.add(rawId);
			}
		});

		// Pass 2: build adjacency from edge path IDs (format: prefix-L_FROM_TO_IDX)
		const neighbors = new Map<string, Set<string>>();
		svg.querySelectorAll("path.flowchart-link").forEach((path) => {
			const pid = path.getAttribute("id") ?? "";
			const lIdx = pid.indexOf("-L_");
			if (lIdx < 0) return;
			const body = pid.slice(lIdx + 3, pid.lastIndexOf("_"));
			for (let i = 1; i < body.length; i++) {
				if (body[i] !== "_") continue;
				const from = body.slice(0, i);
				const to = body.slice(i + 1);
				if (allNodeIds.has(from) && allNodeIds.has(to)) {
					if (!neighbors.has(from)) neighbors.set(from, new Set());
					if (!neighbors.has(to)) neighbors.set(to, new Set());
					neighbors.get(from)?.add(to);
					neighbors.get(to)?.add(from);
					break;
				}
			}
		});

		// Pass 3: bind hover and click events
		let bound = 0;
		for (const [rawId, g] of nodeElements) {
			(g as SVGGElement).style.cursor = "pointer";

			g.addEventListener("mouseenter", () => {
				container.classList.add("hovering");
				g.classList.add("neighbor");
				const nb = neighbors.get(rawId);
				if (nb) nb.forEach((nid) => nodeElements.get(nid)?.classList.add("neighbor"));
			});
			g.addEventListener("mouseleave", () => {
				container.classList.remove("hovering");
				svg.querySelectorAll(".neighbor").forEach((el) => el.classList.remove("neighbor"));
			});

			g.addEventListener("click", (e) => {
				e.stopPropagation();
				if (rawId.endsWith("__summary")) {
					this.setState({ expandedGraphs: [...new Set([...this.state.expandedGraphs, rawId.slice(0, -9)])] });
					return;
				}
				const entry = this.currentNodeMap.get(rawId);
				if (!entry) return;
				if (getRels(entry.graph)) {
					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
							detail: { label: entry.graph, subject: entry.subject },
							bubbles: true,
							composed: true,
						}),
					);
				} else {
					this.showQuadDetail(entry.graph, entry.subject);
				}
			});
			bound++;
		}
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
