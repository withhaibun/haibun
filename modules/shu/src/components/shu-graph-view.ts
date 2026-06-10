/**
 * <shu-graph-view> — Renders all quads as a mermaid graph with subgraphs by namedGraph.
 *
 * Shows the unified quad/graph view: variables, observations, nodes, annotations
 * all in one diagram. Named graphs become subgraph clusters. Cross-graph edges visible.
 *
 * Data comes from MonitorStepper-getQuads RPC + live SSE quad observation events.
 *
 * This view consumes `mermaid-source.ts` directly rather than the generic
 * `TGraph` + `shu-graph` pipeline. The quad-store visualisation needs
 * Mermaid-specific affordances — position-based edge-label matching, summary
 * and cluster node ids, hover/scroll/click semantics tied to the rendered SVG
 * structure — that aren't part of the renderer-agnostic graph abstraction.
 * The chain-view and combined affordance graphs do go through `TGraph`; the
 * abstraction is intentionally not forced onto views whose needs exceed it.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { shuBaseStyles } from "./styles.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import { conduit } from "../hypermedia.js";
import { SHU_EVENT } from "../consts.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";
import { getEdgeRanges, getEdgeRelMap, getRels, getRelSync } from "../rels-cache.js";
import { getStepperForType, requireStep } from "../rpc-registry.js";
import { type TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "../graph-model.js";
import { copyText } from "../copy-util.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import { edgeRel as coreEdgeRel, LinkRelations } from "@haibun/core/lib/resources.js";
import { buildMermaidSource, buildClassifier, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH, type TGraphViewOpts, type PropertyClassifier } from "../mermaid-source.js";
import { GraphControlProductSchema } from "./shu-graph-view.controls-schema.js";

const browserClassifier = buildClassifier(getRels, getEdgeRanges, getStepperForType, undefined);
browserClassifier.relForEdge = (_graph: string, predicate: string) => getEdgeRelMap()[predicate] ?? coreEdgeRel(predicate);
browserClassifier.rel = (graph: string, predicate: string) => getRelSync(graph, predicate) ?? getEdgeRelMap()[predicate] ?? coreEdgeRel(predicate);

const CLASSIFIERS: Record<string, PropertyClassifier> = {
	browser: browserClassifier,
	thread: THREAD_CLASSIFIER,
};

const StateSchema = z.object({
	...clusteredGraphStateShape,
	dataSource: z.enum(["rpc", "external"]).default("rpc"),
	classifierMode: z.enum(["browser", "thread"]).default("browser"),
	zoom: z.number().default(100),
	layout: z.enum(["TD", "LR"]).default("TD"),
	hiddenRels: z.array(z.string()).default([]),
	maxPerSubgraph: z.number().default(DEFAULT_MAX_PER_SUBGRAPH),
});

const ZOOM_STEP = 25; // percent per zoom click — a visible jump, not a nudge

export class ShuGraphView extends ShuClusteredGraphView<typeof StateSchema> {
	static styles = [
		shuBaseStyles,
		css`
		:host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
		:host(:not([data-show-controls])) .toolbar, :host(:not([data-show-controls])) shu-graph-filter, :host(:not([data-show-controls])) .graph-filters { display: none; }
		.toolbar { display: flex; gap: var(--shu-space-2); align-items: center; padding: var(--shu-space-2) var(--shu-space-4); border-bottom: var(--shu-border-w) solid var(--shu-border); flex-wrap: wrap; flex-shrink: 0; background: var(--shu-bg); z-index: 10; }
		.toolbar button { padding: var(--shu-space-1) var(--shu-space-4); cursor: pointer; }
		.toolbar label { font-size: var(--shu-font-md); cursor: pointer; display: flex; align-items: center; gap: var(--shu-space-1); }
		.graph-scroll { flex: 1; overflow: auto; }
		.diagram-container { padding: var(--shu-space-4); }
		.diagram-container .node rect, .diagram-container .node polygon { cursor: pointer; }
		.diagram-container .nodeLabel { text-align: left !important; }
		.diagram-container .node, .diagram-container .edgeLabel, .diagram-container .cluster, .diagram-container path.flowchart-link { transition: opacity 0.15s; }
		.diagram-container path.edge-pattern-dotted { stroke-dasharray: 8 4 !important; stroke-width: 1.5px !important; opacity: 0.7; }
		.zoom-label { color: var(--shu-fg-muted); }
		.quad-count { color: var(--shu-fg-faded); margin-left: auto; }
		.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); text-align: center; }
		.graph-filters { display: flex; gap: var(--shu-space-3); flex-wrap: wrap; padding: var(--shu-space-2) var(--shu-space-4); }
		.diagram-container.filter-highlight .node, .diagram-container.filter-highlight .cluster { opacity: 0.1; }
		.diagram-container.filter-highlight path.flowchart-link, .diagram-container.filter-highlight .edgeLabel { opacity: 0; }
		.diagram-container.filter-highlight .filter-match, .diagram-container.filter-highlight .filter-match * { opacity: 1 !important; }
	`,
	];
	private diagramId = `shu-graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	private currentNodeMap = new Map<string, { graph: string; subject: string }>();
	/** Drawn edges in render order from buildMermaidSource — the nth entry is the nth SVG edge path (exact from/to node ids). */
	private currentDrawnEdges: { from: string; to: string }[] = [];
	private visibleQuads: TQuad[] = [];
	private lastMermaidSource = "";
	/** Last viewport + zoom the SVG was sized for; a change (resize or zoom) forces a re-render so the server bakes in the current scale. */
	private lastFitW = 0;
	private lastFitH = 0;
	private lastZoom = 0;
	private resizeObserved = false;
	private relPredicateMap = new Map<string, Set<string>>();
	/** SVG node rawId → element, populated by bindNodeClicks. */
	private svgNodeElements = new Map<string, Element>();
	/** SVG node rawId → set of connected edge elements (paths + labels), populated by bindNodeClicks. */
	private svgNodeEdgeElements = new Map<string, Set<Element>>();
	/** Structured edge list built by bindNodeClicks for filter hover lookups. */
	private svgEdges: Array<{ pathEl: Element; labelEl: Element | null; fromId: string; toId: string; labelText: string }> = [];
	/** SVG node rawId → adjacent rawIds. Used by selection highlight to mirror hover behavior. */
	private svgNeighbors = new Map<string, Set<string>>();
	/** Reverse lookup: subject → rawId. Avoids the O(N) scan over `currentNodeMap.entries()` on every selection change. */
	private subjectToRawId = new Map<string, string>();
	/** Currently selected subject pinned via `.filter-match`. Cleared on selection change; reapplied after each mermaid re-render. */
	private selectedHighlightSubject: string | null = null;

	/** Provide quads externally — sets dataSource to external, skipping RPC. */
	setQuads(quads: TQuad[]): void {
		this.setState({ quads, dataSource: "external" });
	}

	static observedHtmlAttributes = ["data-classifier", "data-source"];

	protected override onAttributeChanged(name: string, _old: string | null, val: string | null): void {
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
		super(StateSchema, {});
	}

	// Control payload from a {show|hide} graph types step, applied like a filter change.
	set products(p: Record<string, unknown>) {
		const { hideGraphs, showGraphs } = GraphControlProductSchema.parse(p);
		if (hideGraphs || showGraphs) this.applyHiddenChange({ hide: hideGraphs, show: showGraphs });
	}

	protected override get usesExternalData(): boolean {
		return this.state.dataSource === "external";
	}

	protected override async onGraphConnected(): Promise<void> {
		await this.updateComplete; // shadowRoot exists only after the first update
		// Empty-area click releases the focus lock. Delegated on the shadow root once, so each re-render doesn't add another listener.
		this.shadowRoot?.addEventListener("click", (e) => {
			if (e.defaultPrevented) return;
			const target = e.target as Element | null;
			if (!target?.closest(".diagram-container")) return;
			if (target.closest("g.node, g.cluster")) return;
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [] }, bubbles: true, composed: true }));
		});
	}

	// A selection (from any view) pins this subject's highlight; the base fetches its neighborhood if missing.
	protected override onGraphSelection(subject: string | null): void {
		this.applySelectionHighlight(subject);
	}

	private lastTimeSyncRender = 0;
	private timeSyncTimer = 0;

	protected override onTimeSync(): void {
		// Throttle the diagram re-render to 500ms during continuous play.
		// `<shu-graph-filter>` is a ShuElement of its own and re-derives its
		// legend on every TIME_SYNC independently.
		const apply = () => {
			this.lastTimeSyncRender = Date.now();
			this.visibleQuads = this.filterByTime(this.state.quads);
			this.scheduleRender();
		};
		const now = Date.now();
		if (now - this.lastTimeSyncRender >= 500) {
			apply();
		} else if (!this.timeSyncTimer) {
			this.timeSyncTimer = window.setTimeout(() => {
				this.timeSyncTimer = 0;
				apply();
			}, 500);
		}
	}

	render(): TemplateResult {
		const { quads, layout } = this.state;

		if (quads.length === 0) return html`<div class="empty"><shu-spinner></shu-spinner> Loading graph data...</div>`;

		// Filter quads by time cursor — show graph state at that moment
		this.visibleQuads = this.filterByTime(quads);
		const visibleQuads = this.visibleQuads;
		const hiddenRelSet = new Set(this.state.hiddenRels);
		const classifier = this.activeClassifier;

		// Group edge predicates by rel from shared graph model edges.
		const graphModel = buildGraphModelFromQuads(visibleQuads, { clusters: this.state.clusters });
		const relToPredicates = new Map<string, Set<string>>();
		for (const e of graphModel.edges) {
			if (classifier.classify(e.graph, e.predicate) !== "edge") continue;
			const rel = classifier.relForEdge?.(e.graph, e.predicate) ?? e.predicate;
			if (!relToPredicates.has(rel)) relToPredicates.set(rel, new Set());
			relToPredicates.get(rel)?.add(e.predicate);
		}
		this.relPredicateMap = relToPredicates;
		const sortedRels = [...relToPredicates.keys()].sort();

		// Cluster digest (one entry per known namedGraph + counts) — the same
		// shape an `_links`-style consumer would get from a per-cluster query.
		// Emitted as JSON-LD so the chat-context harvester sees the same
		// hypermedia an agent reading the graph would.
		const clusterDigest = (() => {
			const counts = new Map<string, number>();
			for (const q of visibleQuads) counts.set(q.namedGraph, (counts.get(q.namedGraph) ?? 0) + 1);
			return { "@type": "graph-cluster-digest", clusters: [...counts.entries()].map(([name, count]) => ({ name, count })), total: visibleQuads.length };
		})();
		return html`
			${unsafeHTML(this.emitHypermediaScript(clusterDigest))}
			<div class="toolbar" data-testid="graph-view-toolbar">
				<button data-action="layout" @click=${this.onToolbarClick}>${layout}</button>
				<button data-action="zoom-out" @click=${this.onToolbarClick}>−</button>
				<span class="zoom-label"></span>
				<button data-action="zoom-in" @click=${this.onToolbarClick}>+</button>
				<button data-action="copy" @click=${this.onToolbarClick}>Copy</button>
			</div>
			<shu-graph-filter></shu-graph-filter>
			${
				sortedRels.length > 0
					? html`<div class="graph-filters" data-testid="graph-predicate-filters">${sortedRels.map((rel) => {
							const predicates = [...(relToPredicates.get(rel) ?? [])].sort().join(", ");
							return html`<label title=${predicates} @mouseenter=${() => this.highlightRel(rel)} @mouseleave=${() => this.clearFilterHighlight()}><input type="checkbox" data-rel=${rel} ?checked=${!hiddenRelSet.has(rel)} @change=${(e: Event) => this.toggleRel(rel, (e.target as HTMLInputElement).checked)}> ${rel}</label>`;
						})}</div>`
					: ""
			}
			<div class="graph-scroll">
				<div class="diagram-container">
					<div id=${this.diagramId}></div>
				</div>
			</div>
		`;
	}

	protected updated(): void {
		const zoomLabel = this.shadowRoot?.querySelector(".zoom-label");
		if (zoomLabel) zoomLabel.textContent = `${this.state.zoom}%`;
		const filterEl = this.shadowRoot?.querySelector("shu-graph-filter") as ShuGraphFilter | null;
		if (filterEl) {
			if (this.showControls) filterEl.setAttribute("show-controls", "");
			else filterEl.removeAttribute("show-controls");
			filterEl.setSource(this.knownClusters, this.state.quads);
		}
		this.observeViewportResize();
		this.scheduleRender();
	}

	/** Re-render when the scroll viewport resizes (a column drag, window resize) so the SVG re-fills the new size. Once. */
	private observeViewportResize(): void {
		if (this.resizeObserved || typeof ResizeObserver === "undefined") return;
		const view = this.shadowRoot?.querySelector(".graph-scroll");
		if (!view) return;
		this.resizeObserved = true;
		const observer = new ResizeObserver(() => this.scheduleRender());
		observer.observe(view);
		this.autoTeardown(() => observer.disconnect());
	}

	private async onToolbarClick(e: Event): Promise<void> {
		const target = e.currentTarget as HTMLElement;
		const action = target.dataset.action;
		if (action === "zoom-in" || action === "zoom-out") {
			const zoom = action === "zoom-in" ? this.state.zoom + ZOOM_STEP : Math.max(ZOOM_STEP, this.state.zoom - ZOOM_STEP);
			this.state.zoom = zoom;
			const label = this.shadowRoot?.querySelector(".zoom-label");
			if (label) label.textContent = `${zoom}%`;
			// Zoom IS the server render scale now — re-render the SVG at the new size rather than CSS-scaling a fixed render.
			this.scheduleRender();
			return;
		}
		if (action === "layout") this.setState({ layout: this.state.layout === "TD" ? "LR" : "TD" });
		// copyText falls back to execCommand when the async Clipboard API is blocked (e.g. a file:// report); show the result rather than fail silently.
		else if (action === "copy") {
			const ok = await copyText(buildMermaidSource(this.visibleQuads, this.buildOpts(), this.activeClassifier).source);
			target.textContent = ok ? "Copied" : "Copy failed";
			setTimeout(() => {
				target.textContent = "Copy";
			}, 1500);
		}
	}

	private toggleRel(rel: string, checked: boolean): void {
		const hidden = new Set(this.state.hiddenRels);
		if (checked) hidden.delete(rel);
		else hidden.add(rel);
		this.setState({ hiddenRels: [...hidden] });
	}

	/** Hover-highlight every edge carrying this rel, plus the nodes it connects. */
	private highlightRel(rel: string): void {
		const container = this.shadowRoot?.querySelector(".diagram-container");
		if (!container) return;
		container.classList.add("filter-highlight");
		const predicates = this.edgeRelToPredicates(rel);
		for (const edge of this.svgEdges) {
			if (edge.labelText !== rel && !predicates.has(edge.labelText)) continue;
			edge.pathEl.classList.add("filter-match");
			if (edge.labelEl) edge.labelEl.classList.add("filter-match");
			this.svgNodeElements.get(edge.fromId)?.classList.add("filter-match");
			this.svgNodeElements.get(edge.toId)?.classList.add("filter-match");
		}
	}

	private edgeRelToPredicates(rel: string): Set<string> {
		return this.relPredicateMap.get(rel) ?? new Set();
	}

	private buildOpts(): TGraphViewOpts {
		const labelsByType = new Map<string, Record<string, string>>();
		for (const c of this.state.clusters) labelsByType.set(c.type, c.displayLabels);
		return {
			layout: this.state.layout,
			hiddenGraphs: new Set(this.state.hiddenGraphs),
			expandedGraphs: new Set(this.state.expandedGraphs),
			maxPerSubgraph: this.state.maxPerSubgraph,
			hiddenRels: new Set(this.state.hiddenRels),
			displayLabel: (graph, subject) => labelsByType.get(graph)?.[subject],
		};
	}

	private clearFilterHighlight(): void {
		this.clearAllHighlightClasses();
		// A pinned selection highlight survives transient hover dismissals.
		if (this.selectedHighlightSubject) this.paintHighlight(this.selectedHighlightSubject);
	}

	private clearAllHighlightClasses(): void {
		const container = this.shadowRoot?.querySelector(".diagram-container");
		container?.classList.remove("filter-highlight");
		container?.querySelectorAll(".filter-match").forEach((el) => el.classList.remove("filter-match"));
	}

	/**
	 * Pin highlight on a subject + its immediate neighbours, mirroring the hover
	 * appearance. The subject string is the node id used in the strip's
	 * COLUMN_OPEN / CONTEXT_CHANGE flow; resolved to the SVG raw id
	 * (which prefixes the graph name) by scanning currentNodeMap.
	 */
	private applySelectionHighlight(subject: string | null): void {
		if (subject === this.selectedHighlightSubject) return;
		this.selectedHighlightSubject = subject;
		this.clearAllHighlightClasses();
		if (!subject) return;
		this.paintHighlight(subject);
		// `paintHighlight` is also invoked from `clearFilterHighlight` (every
		// mouseleave) and after each mermaid re-render; scrolling there would
		// yank the viewport. Scroll only on actual selection change.
		this.scrollSubjectIntoView(subject);
	}

	private paintHighlight(subject: string): void {
		const rawId = this.subjectToRawId.get(subject);
		if (!rawId) return;
		const container = this.shadowRoot?.querySelector(".diagram-container");
		container?.classList.add("filter-highlight");
		this.svgNodeElements.get(rawId)?.classList.add("filter-match");
		this.svgNeighbors.get(rawId)?.forEach((nid) => this.svgNodeElements.get(nid)?.classList.add("filter-match"));
		this.svgNodeEdgeElements.get(rawId)?.forEach((el) => el.classList.add("filter-match"));
	}

	/**
	 * Scroll the matching SVG node into the `.graph-scroll` container's view —
	 * the immediate scrollable ancestor — without bubbling to the column-strip
	 * or page. Walking up via the default `scrollIntoView` would shift the
	 * surrounding pane and feel like a zoom change.
	 */
	private scrollSubjectIntoView(subject: string): void {
		const rawId = this.subjectToRawId.get(subject);
		const nodeEl = rawId ? (this.svgNodeElements.get(rawId) as SVGGraphicsElement | undefined) : undefined;
		const scroller = this.shadowRoot?.querySelector(".graph-scroll") as HTMLElement | null;
		if (!nodeEl || !scroller) return;
		const nodeRect = nodeEl.getBoundingClientRect();
		const scrollerRect = scroller.getBoundingClientRect();
		const dx = nodeRect.left + nodeRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
		const dy = nodeRect.top + nodeRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
		scroller.scrollBy({ left: dx, top: dy, behavior: "smooth" });
	}

	private renderTimer: ReturnType<typeof setTimeout> | undefined;
	// Coalesce render requests: SSE batches and reactive updates fire often and each render is a server round-trip, so debounce to the last settled state.
	private scheduleRender(): void {
		if (this.renderTimer !== undefined) clearTimeout(this.renderTimer);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			void this.renderMermaid();
		}, 150);
	}

	private async renderMermaid(): Promise<void> {
		const { source, nodeMap, drawnEdges } = buildMermaidSource(this.visibleQuads, this.buildOpts(), this.activeClassifier);
		// The server sizes the SVG to the viewport scaled by the current zoom (so the zoom IS the render scale, not a
		// separate CSS transform); re-render when the source, the viewport (resize), or the zoom changes.
		const view = this.shadowRoot?.querySelector(".graph-scroll") as HTMLElement | null;
		const vw = view?.clientWidth ?? 0;
		const vh = view?.clientHeight ?? 0;
		const zoom = this.state.zoom;
		if (source === this.lastMermaidSource && vw === this.lastFitW && vh === this.lastFitH && zoom === this.lastZoom) return;
		this.lastMermaidSource = source;
		this.lastFitW = vw;
		this.lastFitH = vh;
		this.lastZoom = zoom;
		const scale = zoom / 100;
		const fitW = Math.round(vw * scale);
		const fitH = Math.round(vh * scale);
		this.currentNodeMap = nodeMap;
		this.currentDrawnEdges = drawnEdges;
		this.subjectToRawId = new Map();
		for (const [rawId, v] of nodeMap) this.subjectToRawId.set(v.subject, rawId);
		try {
			// mermaid renders server-side (the client ships no mermaid); the returned SVG keeps mermaid's structure, so bindNodeClicks works unchanged.
			// Send the scroll viewport size so the server sizes the SVG to fill it (uses the vertical space); re-rendered on resize.
			const rendered = await conduit().follow<{ svg: string; nodeMap?: [string, { graph: string; subject: string }][]; drawnEdges?: { from: string; to: string }[] }>(
				{ method: requireStep("renderMermaid"), params: { source, width: fitW, height: fitH } },
				"graph-view: render mermaid",
			);
			// Offline, the report serves an SVG that was server-rendered and embedded at report-write time — possibly from a
			// different source than the client just built. When the response carries that SVG's own nodeMap + edge list,
			// adopt them so hover/click map onto the rendered SVG, not the client's locally-built (and possibly divergent) graph.
			if (rendered.nodeMap) {
				this.currentNodeMap = new Map(rendered.nodeMap);
				this.subjectToRawId = new Map();
				for (const [rawId, v] of this.currentNodeMap) this.subjectToRawId.set(v.subject, rawId);
			}
			if (rendered.drawnEdges) this.currentDrawnEdges = rendered.drawnEdges;
			// Inject into the empty #diagramId leaf, not .diagram-container: that leaf has no template children, so lit
			// never reconciles it and the SVG survives re-renders. Scroll lives on the .graph-scroll wrapper.
			const host = this.shadowRoot?.getElementById(this.diagramId);
			if (host) {
				const scroller = this.shadowRoot?.querySelector(".graph-scroll");
				const scrollTop = scroller?.scrollTop ?? 0;
				const scrollLeft = scroller?.scrollLeft ?? 0;
				host.innerHTML = rendered.svg;
				if (scroller) {
					scroller.scrollTop = scrollTop;
					scroller.scrollLeft = scrollLeft;
				}
				this.bindNodeClicks(host);
			}
		} catch (err) {
			const host = this.shadowRoot?.getElementById(this.diagramId);
			if (host) host.innerHTML = `<pre style="color:var(--shu-error)">${err instanceof Error ? err.message : err}</pre>`;
		}
	}

	/** Make nodes clickable; highlight node + its neighbors + connecting edges on hover. */
	private bindNodeClicks(container: Element): void {
		const svg = container.querySelector("svg");
		if (!svg) return;
		// The SVG is injected into the inner diagram leaf, but the dim/highlight CSS keys off `.diagram-container.filter-highlight`
		// (matching highlightRel/paintHighlight) — toggle the class on the container, not the leaf, or hover has no visible effect.
		const diagram = container.closest(".diagram-container") ?? container;

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

		// Pass 2: build adjacency + collect edge elements per node.
		// Mermaid v11: edge paths (path.flowchart-link) and edge labels (.edgeLabels > .edgeLabel)
		// have no IDs linking them — they correspond by position (nth path ↔ nth label).
		const neighbors = new Map<string, Set<string>>();
		const nodeEdgeElements = new Map<string, Set<Element>>();
		const edgePaths = Array.from(svg.querySelectorAll("path.flowchart-link"));
		const edgeLabelEls = Array.from(svg.querySelectorAll(".edgeLabels > .edgeLabel"));
		this.svgEdges = [];

		// The nth edge path is the nth drawn edge from the source (same render order), and the nth label too. Use the
		// source's exact from/to node ids rather than parsing them out of the path id — that id is ambiguous when node
		// ids contain underscores (e.g. `L_A_B_C` could be A→B_C or A_B→C), which mislinked adjacency for some nodes.
		edgePaths.forEach((path, i) => {
			const edge = this.currentDrawnEdges[i];
			const labelEl = edgeLabelEls[i] ?? null;
			if (!edge || !allNodeIds.has(edge.from) || !allNodeIds.has(edge.to)) return;
			const { from, to } = edge;
			if (!neighbors.has(from)) neighbors.set(from, new Set());
			if (!neighbors.has(to)) neighbors.set(to, new Set());
			neighbors.get(from)?.add(to);
			neighbors.get(to)?.add(from);
			// Collect edge path + label elements for both endpoints
			for (const nid of [from, to]) {
				if (!nodeEdgeElements.has(nid)) nodeEdgeElements.set(nid, new Set());
				nodeEdgeElements.get(nid)?.add(path);
				if (labelEl) nodeEdgeElements.get(nid)?.add(labelEl);
			}
			const labelText = labelEl?.textContent?.trim() ?? "";
			this.svgEdges.push({ pathEl: path, labelEl, fromId: from, toId: to, labelText });
		});

		// Promote maps to instance properties for use by filter hover handlers
		this.svgNodeElements = nodeElements;
		this.svgNodeEdgeElements = nodeEdgeElements;
		this.svgNeighbors = neighbors;
		// The rebuilt SVG lost any prior `.filter-match` classes; reapply a sticky selection highlight.
		if (this.selectedHighlightSubject) this.paintHighlight(this.selectedHighlightSubject);

		for (const [rawId, g] of nodeElements) {
			(g as SVGGElement).style.cursor = "pointer";

			g.addEventListener("mouseenter", () => {
				diagram.classList.add("filter-highlight");
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
				if (rawId.startsWith("cluster:")) {
					const type = rawId.slice("cluster:".length);
					this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_CLUSTER_EXPAND, { detail: { type }, bubbles: true, composed: true }));
					return;
				}
				const entry = this.currentNodeMap.get(rawId);
				if (!entry) throw new Error(`shu-graph-view: clicked node "${rawId}" has no entry in currentNodeMap — the render and the click handlers are out of sync`);
				if (getRels(entry.graph)) {
					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
							detail: { label: entry.graph, subject: entry.subject, addToSelection: (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey },
							bubbles: true,
							composed: true,
						}),
					);
					return;
				}
				// Non-individual graph (no rels registered for the namedGraph). Two
				// shapes reach here:
				//   • seqPath subjects (single-product steps emit the producing
				//     seqPath as the subject; multi-product steps emit
				//     `${seqPath}#${field}`) → step-detail pane.
				//   • Anything else (working-memory variables, goal-affordance
				//     bindings, …) → not a step-detail; make the subject the
				//     chat context. Same `CONTEXT_CHANGE` event row clicks dispatch,
				//     so the actions-bar, status badge, and chat hypermedia all see
				//     this pick through the same channel.
				const head = entry.subject.includes("#") ? entry.subject.slice(0, entry.subject.indexOf("#")) : entry.subject;
				const directSeqPath = parseSeqPath(head);
				if (directSeqPath) {
					PaneState.requestFrom(this, { paneType: "step-detail", seqPath: directSeqPath });
					return;
				}
				const seqPathQuad = this.state.quads.find((q) => q.subject === entry.subject && q.predicate === LinkRelations.SEQ_PATH.rel);
				if (!seqPathQuad)
					throw new Error(
						`shu-graph-view: no producing seqPath recorded for subject "${entry.subject}" in graph "${entry.graph}" — the writing dispatch emits a (subject, seqPath, <path>) quad and this view should have it`,
					);
				const writtenSeqPath = parseSeqPath(String(seqPathQuad.object));
				if (!writtenSeqPath) throw new Error(`shu-graph-view: producing seqPath quad for "${entry.subject}" has unparseable object: ${JSON.stringify(seqPathQuad.object)}`);
				PaneState.requestFrom(this, { paneType: "step-detail", seqPath: writtenSeqPath });
			});
		}
	}
}
