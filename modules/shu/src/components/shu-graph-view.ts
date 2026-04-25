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
import { SseClient, inAction } from "../sse-client.js";
import { SHU_EVENT } from "../consts.js";
import { openQuadDetailPane } from "../quad-detail-pane.js";
import { getEdgeRanges, getEdgeRelMap, getRels } from "../rels-cache.js";
import { getAvailableSteps, getStepperForType } from "../rpc-registry.js";
import { extractQuadsFromEvents, type TQuad } from "@haibun/core/lib/quad-types.js";
import { edgeRel as coreEdgeRel } from "@haibun/core/lib/resources.js";
import { buildMermaidSource, buildClassifier, sanitizeId, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH, type TGraphViewOpts, type PropertyClassifier } from "../mermaid-source.js";

let mermaidInitialized = false;

const browserClassifier = buildClassifier(getRels, getEdgeRanges, getStepperForType, undefined);
browserClassifier.relForEdge = (_graph: string, predicate: string) => getEdgeRelMap()[predicate] ?? coreEdgeRel(predicate);

const CLASSIFIERS: Record<string, PropertyClassifier> = {
	browser: browserClassifier,
	thread: THREAD_CLASSIFIER,
};

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
	dataSource: z.enum(["rpc", "external"]).default("rpc"),
	classifierMode: z.enum(["browser", "thread"]).default("browser"),
	zoom: z.number().default(100),
	layout: z.enum(["TD", "LR"]).default("TD"),
	hiddenGraphs: z.array(z.string()).default([]),
	hiddenRels: z.array(z.string()).default([]),
	expandedGraphs: z.array(z.string()).default([]),
	maxPerSubgraph: z.number().default(DEFAULT_MAX_PER_SUBGRAPH),
});

const STYLES = `
:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
:host(:not([data-show-controls])) .toolbar { display: none; }
.toolbar { display: flex; gap: 4px; align-items: center; padding: 4px 8px; border-bottom: 1px solid #ddd; flex-wrap: wrap; flex-shrink: 0; background: #fff; z-index: 10; }
.toolbar button { padding: 2px 8px; cursor: pointer; }
.toolbar label { font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.graph-scroll { flex: 1; overflow: auto; }
.diagram-container { padding: 8px; }
.diagram-container .node rect, .diagram-container .node polygon { cursor: pointer; }
.diagram-container .nodeLabel { text-align: left !important; }
.diagram-container .node, .diagram-container .edgePath, .diagram-container .edgeLabel, .diagram-container .cluster, .diagram-container .edgePaths path { transition: opacity 0.15s; }
.diagram-container path.edge-pattern-dotted { stroke-dasharray: 8 4 !important; stroke-width: 1.5px !important; opacity: 0.7; }
.zoom-label { color: #666; }
.quad-count { color: #888; margin-left: auto; }
.empty { padding: 16px; color: #888; text-align: center; }
.graph-filters { display: flex; gap: 6px; flex-wrap: wrap; margin-left: 8px; }
.diagram-container.filter-highlight .node, .diagram-container.filter-highlight .cluster { opacity: 0.1; }
.diagram-container.filter-highlight .edgePath, .diagram-container.filter-highlight .edgeLabel, .diagram-container.filter-highlight .edgePaths path { opacity: 0; }
.diagram-container.filter-highlight .filter-match { opacity: 1 !important; }
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
	private initialized = false;
	private relPredicateMap = new Map<string, Set<string>>();
	/** SVG node rawId → element, populated by bindNodeClicks. */
	private svgNodeElements = new Map<string, Element>();
	/** SVG node rawId → set of connected edge elements (paths + labels), populated by bindNodeClicks. */
	private svgNodeEdgeElements = new Map<string, Set<Element>>();
	/** Structured edge list built by bindNodeClicks for filter hover lookups. */
	private svgEdges: Array<{ pathEl: Element; labelEl: Element | null; fromId: string; toId: string; labelText: string }> = [];

	/** Provide quads externally — sets dataSource to external, skipping RPC. */
	setQuads(quads: TQuad[]): void {
		this.setState({ quads, dataSource: "external" });
	}

	static get observedAttributes(): string[] {
		return ["data-classifier", "data-source"];
	}

	attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
		if (name === "data-classifier" && val && val in CLASSIFIERS) {
			this.state = { ...this.state, classifierMode: val as "browser" | "thread" };
		}
		if (name === "data-source" && (val === "rpc" || val === "external")) {
			// External data: start with all graphs visible (don't inherit main view's hidden cookie)
			this.state = { ...this.state, dataSource: val, ...(val === "external" ? { hiddenGraphs: [] } : {}) };
		}
	}

	private get activeClassifier(): PropertyClassifier {
		return CLASSIFIERS[this.state.classifierMode] ?? browserClassifier;
	}

	constructor() {
		super(StateSchema, {
			quads: [],
			dataSource: "rpc",
			classifierMode: "browser",
			zoom: 100,
			layout: "TD",
			hiddenGraphs: readHiddenGraphsCookie(),
			hiddenRels: [],
			expandedGraphs: [],
			maxPerSubgraph: DEFAULT_MAX_PER_SUBGRAPH,
		});
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		if (this.initialized) return;
		this.initialized = true;

		// External mode: data provided via setQuads, skip RPC and SSE.
		if (this.state.dataSource === "external") return;
		const isSnapshot = this.hasAttribute("data-snapshot-time");

		const client = SseClient.for("");
		await getAvailableSteps();

		try {
			const data = await inAction((scope) => client.rpc<{ quads: TQuad[] }>(scope, "MonitorStepper-getQuads"));
			if (data.quads?.length) this.setState({ quads: data.quads });
		} catch {
			/* stepper may not be loaded */
		}

		// Snapshot mode: fetch once, no live updates
		if (isSnapshot) return;

		this.unsubscribe = client.onEvent((event) => {
			const quads = extractQuadsFromEvents([event as Record<string, unknown>]);
			if (quads.length > 0) this.setState({ quads: [...this.state.quads, ...quads] });
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
		this.lastMermaidSource = "";
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
		const hiddenRelSet = new Set(this.state.hiddenRels);
		const classifier = this.activeClassifier;

		// Group edge predicates by rel — only include predicates that connect to another entity
		const entityIds = new Set(visibleQuads.map((q) => q.subject));
		const relToPredicates = new Map<string, Set<string>>();
		for (const q of visibleQuads) {
			if (typeof q.object !== "string" || !entityIds.has(q.object)) continue;
			if (classifier.classify(q.namedGraph, q.predicate) !== "edge") continue;
			const rel = classifier.relForEdge?.(q.namedGraph, q.predicate) ?? q.predicate;
			if (!relToPredicates.has(rel)) relToPredicates.set(rel, new Set());
			relToPredicates.get(rel)?.add(q.predicate);
		}
		this.relPredicateMap = relToPredicates;
		const sortedRels = [...relToPredicates.keys()].sort();

		const filterHtml = graphs.map((g) => `<label><input type="checkbox" data-graph="${g}" ${hiddenSet.has(g) ? "" : "checked"}> ${g}</label>`).join("");
		const edgeFilterHtml = sortedRels.length > 0 ? `<span style="margin-left:4px;color:#888">|</span> ${sortedRels.map((rel) => {
			const predicates = [...(relToPredicates.get(rel) ?? [])].sort().join(", ");
			return `<label title="${predicates}"><input type="checkbox" data-rel="${rel}" ${hiddenRelSet.has(rel) ? "" : "checked"}> ${rel}</label>`;
		}).join("")}` : "";

		this.lastMermaidSource = "";
		const toolbar = `<div class="toolbar" data-testid="graph-view-toolbar">
			<button data-action="layout">${layout}</button>
			<button data-action="zoom-out">\u2212</button>
			<span class="zoom-label">${zoom}%</span>
			<button data-action="zoom-in">+</button>
			<button data-action="copy">Copy</button>
			<label>limit <input type="number" data-action="max" value="${maxPerSubgraph}" min="1" max="999" style="width:40px"></label>
			<div class="graph-filters">${filterHtml}${edgeFilterHtml}</div>
			<span class="quad-count">${visibleQuads.length} quads</span>
		</div>`;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}${toolbar}
			<div class="graph-scroll">
				<div class="diagram-container" style="transform: scale(${zoom / 100}); transform-origin: top left;">
					<div id="${this.diagramId}"></div>
				</div>
			</div>`;

		this.bindToolbar();
		void this.renderMermaid();
	}

	private bindToolbar(): void {
		this.shadowRoot?.querySelectorAll("[data-action]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const action = (btn as HTMLElement).dataset.action;
				if (action === "zoom-in" || action === "zoom-out") {
					const zoom = action === "zoom-in" ? this.state.zoom + 10 : Math.max(1, this.state.zoom - 10);
					this.state.zoom = zoom;
					const container = this.shadowRoot?.querySelector(".diagram-container") as HTMLElement | null;
					if (container) container.style.transform = `scale(${zoom / 100})`;
					const label = this.shadowRoot?.querySelector(".zoom-label");
					if (label) label.textContent = `${zoom}%`;
					return;
				}
				if (action === "layout") this.setState({ layout: this.state.layout === "TD" ? "LR" : "TD" });
				else if (action === "copy") navigator.clipboard.writeText(buildMermaidSource(this.visibleQuads, this.buildOpts(), this.activeClassifier).source);
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
		this.shadowRoot?.querySelectorAll("input[data-rel]").forEach((cb) => {
			cb.addEventListener("change", () => {
				const rel = (cb as HTMLInputElement).dataset.rel ?? "";
				const checked = (cb as HTMLInputElement).checked;
				const hidden = new Set(this.state.hiddenRels);
				if (checked) hidden.delete(rel);
				else hidden.add(rel);
				this.setState({ hiddenRels: [...hidden] });
			});
		});
		const container = this.shadowRoot?.querySelector(".diagram-container");
		this.shadowRoot?.querySelectorAll("input[data-graph], input[data-rel]").forEach((cb) => {
			const label = cb.closest("label");
			label?.addEventListener("mouseenter", () => {
				const graphName = (cb as HTMLInputElement).dataset.graph;
				const relName = (cb as HTMLInputElement).dataset.rel;
				if (!container) return;
				container.classList.add("filter-highlight");
				if (graphName) {
					const graphId = sanitizeId(graphName);
					container.querySelectorAll(`[id*="${graphId}"]`).forEach((el) => {
						const node = el.closest(".node") ?? el.closest(".cluster");
						if (node) node.classList.add("filter-match");
					});
					// Also highlight edges connecting to/from nodes in this graph
					for (const [rawId, entry] of this.currentNodeMap) {
						if (entry.graph !== graphName) continue;
						this.svgNodeEdgeElements.get(rawId)?.forEach((el) => el.classList.add("filter-match"));
					}
				}
				if (relName) {
					const predicates = this.edgeRelToPredicates(relName);
					for (const edge of this.svgEdges) {
						if (edge.labelText !== relName && !predicates.has(edge.labelText)) continue;
						edge.pathEl.classList.add("filter-match");
						if (edge.labelEl) edge.labelEl.classList.add("filter-match");
						this.svgNodeElements.get(edge.fromId)?.classList.add("filter-match");
						this.svgNodeElements.get(edge.toId)?.classList.add("filter-match");
					}
				}
			});
			label?.addEventListener("mouseleave", () => this.clearFilterHighlight());
		});
		const maxInput = this.shadowRoot?.querySelector("input[data-action='max']") as HTMLInputElement | null;
		maxInput?.addEventListener("change", () => {
			const val = parseInt(maxInput.value, 10);
			if (val > 0) this.setState({ maxPerSubgraph: val });
		});
	}

	private edgeRelToPredicates(rel: string): Set<string> {
		return this.relPredicateMap.get(rel) ?? new Set();
	}

	private buildOpts(): TGraphViewOpts {
		return {
			layout: this.state.layout,
			hiddenGraphs: new Set(this.state.hiddenGraphs),
			expandedGraphs: new Set(this.state.expandedGraphs),
			maxPerSubgraph: this.state.maxPerSubgraph,
			hiddenRels: new Set(this.state.hiddenRels),
		};
	}

	private clearFilterHighlight(): void {
		const container = this.shadowRoot?.querySelector(".diagram-container");
		container?.classList.remove("filter-highlight");
		container?.querySelectorAll(".filter-match").forEach((el) => el.classList.remove("filter-match"));
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
		const { source, nodeMap } = buildMermaidSource(this.visibleQuads, this.buildOpts(), this.activeClassifier);
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

		// Pass 2: build adjacency + collect edge elements per node
		const neighbors = new Map<string, Set<string>>();
		const nodeEdgeElements = new Map<string, Set<Element>>();
		const edgeGroups = svg.querySelectorAll(".edgePaths path.flowchart-link, .edgeLabels .edgeLabel");
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
					// Collect edge path + label elements for both endpoints
					const edgePath = path.closest(".edgePath") ?? path;
					for (const nid of [from, to]) {
						if (!nodeEdgeElements.has(nid)) nodeEdgeElements.set(nid, new Set());
						nodeEdgeElements.get(nid)?.add(edgePath);
					}
					// Find matching edge label by index
					const edgeIdx = pid.match(/-(\d+)$/)?.[1];
					if (edgeIdx) {
						edgeGroups.forEach((el) => {
							const eid = el.getAttribute("id") ?? "";
							if (eid.endsWith(`-${edgeIdx}`)) {
								const label = el.closest(".edgeLabel") ?? el;
								for (const nid of [from, to]) nodeEdgeElements.get(nid)?.add(label);
							}
						});
					}
					break;
				}
			}
		});

		// Promote maps to instance properties for use by filter hover handlers
		this.svgNodeElements = nodeElements;
		this.svgNodeEdgeElements = nodeEdgeElements;
		this.svgEdges = [];
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
					const edgePath = path.closest(".edgePath") ?? path;
					const edgeIdx = pid.match(/-(\d+)$/)?.[1];
					let labelEl: Element | null = null;
					let labelText = "";
					if (edgeIdx) {
						edgeGroups.forEach((el) => {
							const eid = el.getAttribute("id") ?? "";
							if (eid.endsWith(`-${edgeIdx}`)) {
								labelEl = (el.closest(".edgeLabel") ?? el) as Element;
								labelText = el.textContent?.trim() ?? "";
							}
						});
					}
					this.svgEdges.push({ pathEl: edgePath, labelEl, fromId: from, toId: to, labelText });
					break;
				}
			}
		});

		let bound = 0;
		for (const [rawId, g] of nodeElements) {
			(g as SVGGElement).style.cursor = "pointer";

			g.addEventListener("mouseenter", () => {
				container.classList.add("filter-highlight");
				g.classList.add("filter-match");
				const nb = neighbors.get(rawId);
				if (nb) nb.forEach((nid) => nodeElements.get(nid)?.classList.add("filter-match"));
				nodeEdgeElements.get(rawId)?.forEach((el) => el.classList.add("filter-match"));
			});
			g.addEventListener("mouseleave", () => this.clearFilterHighlight());

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
