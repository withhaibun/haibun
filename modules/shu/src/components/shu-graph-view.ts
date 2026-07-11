/**
 * <shu-graph-view> — the quad-store overview: every visible quad as one SVG graph,
 * with a cluster box per named graph and cross-graph edges drawn between them.
 *
 * Variables, observations, nodes, and annotations share one diagram. Data comes
 * from the MonitorStepper-getQuads RPC plus live SSE quad-observation events.
 *
 * Projection and drawing are the shared graph engine: `buildGraphTopology` turns the
 * quads into a renderer-agnostic `TGraph` (a summary node past the per-group cap,
 * external reference nodes, edges resolved by the property classifier) and
 * `graphToSvg` paints it. Hover, selection, neighbour highlight, and click routing
 * are wired over the painted `g.node`/`g.edge` elements.
 */
import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { shuBaseStyles } from "./styles.js";
import { z } from "zod";
import { ShuClusteredGraphView, clusteredGraphStateShape } from "./shu-clustered-graph-view.js";
import { SHU_EVENT } from "../consts.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";
import { getEdgeRanges, getEdgeRelMap, getRels, getRelSync, whenSiteMetadataReady } from "../rels-cache.js";
import { isSchemaType, ONTOLOGY_CLASS } from "../graph/ontology-projection.js";
import { openRef } from "./shu-ref.js";
import { getStepperForType } from "../rpc-registry.js";
import { type TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "../graph-model.js";
import { copyText } from "../copy-util.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import { edgeRel as coreEdgeRel, LinkRelations } from "@haibun/core/lib/resources.js";
import { buildClassifier, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH, type TGraphViewOpts, type PropertyClassifier } from "../graph-classifier.js";
import { buildGraphTopology, isSummaryId, summaryGraphOf } from "../graph/graph-topology.js";
import { graphToSvg, graphToDot, findSvgNodes, findSvgEdges } from "../graph/svg-renderer.js";
import { buildNeighbors } from "../graph/filter-graph.js";
import type { TGraph } from "../graph/types.js";
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
		.diagram-container { padding: var(--shu-space-4); transform-origin: top left; }
		.diagram-container g.node { cursor: pointer; }
		.diagram-container g.node, .diagram-container g.edge, .diagram-container g.group { transition: opacity 0.15s; }
		.zoom-label { color: var(--shu-fg-muted); }
		.quad-count { color: var(--shu-fg-faded); margin-left: auto; }
		.empty { padding: var(--shu-space-6); color: var(--shu-fg-faded); text-align: center; }
		.graph-filters { display: flex; gap: var(--shu-space-3); flex-wrap: wrap; padding: var(--shu-space-2) var(--shu-space-4); }
		.diagram-container.filter-highlight g.node, .diagram-container.filter-highlight g.group { opacity: 0.1; }
		.diagram-container.filter-highlight g.edge { opacity: 0.1; }
		.diagram-container.filter-highlight .filter-match, .diagram-container.filter-highlight .filter-match * { opacity: 1 !important; }
	`,
	];
	private diagramId = `shu-graph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	private currentNodeMap = new Map<string, { graph: string; subject: string }>();
	private lastSource = "";
	/** SVG node id → its `<g class="node">` element, populated by bindSvg. */
	private svgNodeElements = new Map<string, Element>();
	/** SVG node id → set of incident edge `<g>` elements, populated by bindSvg. */
	private svgNodeEdgeElements = new Map<string, Set<Element>>();
	/** SVG node id → adjacent node ids. Used by selection highlight to mirror hover behavior. */
	private svgNeighbors = new Map<string, Set<string>>();
	/** Reverse lookup: subject → rawId. Avoids the O(N) scan over `currentNodeMap.entries()` on every selection change. */
	private subjectToRawId = new Map<string, string>();
	/** Currently selected subject pinned via `.filter-match`. Cleared on selection change; reapplied after each SVG repaint. */
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
			if (target.closest("g.node, g.group")) return;
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [] }, bubbles: true, composed: true }));
		});
		// Edges classify via the browser classifier, which needs site metadata; once it is ready, repaint so edges appear
		// regardless of whether another view primed the cache first (matters both live and in the offline report).
		void whenSiteMetadataReady().then(() => this.scheduleRender());
	}

	// A selection (from any view) pins this subject's highlight; the base fetches its neighborhood if missing.
	protected override onGraphSelection(subject: string | null): void {
		this.applySelectionHighlight(subject);
	}

	// Time-cursor filtering lives on the base (visibleQuads + throttled onTimeSync): one pathway for every
	// clustered view. `<shu-graph-filter>` is a ShuElement of its own and re-derives its legend independently.

	render(): TemplateResult {
		const { quads, layout } = this.state;

		if (quads.length === 0) return html`<div class="empty"><shu-spinner></shu-spinner> Loading graph data...</div>`;

		// The base's time-filtered slice — the graph state at the cursor's moment
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
		this.applyZoom();
		this.scheduleRender();
	}

	private async onToolbarClick(e: Event): Promise<void> {
		const target = e.currentTarget as HTMLElement;
		const action = target.dataset.action;
		if (action === "zoom-in" || action === "zoom-out") {
			const zoom = action === "zoom-in" ? this.state.zoom + ZOOM_STEP : Math.max(ZOOM_STEP, this.state.zoom - ZOOM_STEP);
			this.state.zoom = zoom;
			const label = this.shadowRoot?.querySelector(".zoom-label");
			if (label) label.textContent = `${zoom}%`;
			// The SVG is painted at its natural layout size; zoom is a CSS scale of the diagram, not a re-layout.
			this.applyZoom();
			return;
		}
		if (action === "layout") this.setState({ layout: this.state.layout === "TD" ? "LR" : "TD" });
		// copyText falls back to execCommand when the async Clipboard API is blocked (e.g. a file:// report); show the result rather than fail silently.
		else if (action === "copy") {
			const { graph } = buildGraphTopology(this.visibleQuads, this.buildOpts(), this.activeClassifier);
			const ok = await copyText(graphToDot(graph));
			target.textContent = ok ? "Copied" : "Copy failed";
			setTimeout(() => {
				target.textContent = "Copy";
			}, 1500);
		}
	}

	/** Scale the painted diagram to the current zoom (transform-origin is top-left). */
	private applyZoom(): void {
		const container = this.shadowRoot?.querySelector(".diagram-container") as HTMLElement | null;
		if (container) container.style.transform = this.state.zoom === 100 ? "" : `scale(${this.state.zoom / 100})`;
	}

	private toggleRel(rel: string, checked: boolean): void {
		const hidden = new Set(this.state.hiddenRels);
		if (checked) hidden.delete(rel);
		else hidden.add(rel);
		this.setState({ hiddenRels: [...hidden] });
	}

	/** Hover-highlight every edge carrying this rel, plus the nodes it connects. */
	private highlightRel(rel: string): void {
		const host = this.shadowRoot?.getElementById(this.diagramId);
		const container = this.shadowRoot?.querySelector(".diagram-container");
		if (!host || !container) return;
		container.classList.add("filter-highlight");
		for (const edge of Array.from(host.querySelectorAll("g.edge"))) {
			if (edge.getAttribute("data-rel") !== rel) continue;
			edge.classList.add("filter-match");
			const from = edge.getAttribute("data-from");
			const to = edge.getAttribute("data-to");
			if (from) this.svgNodeElements.get(from)?.classList.add("filter-match");
			if (to) this.svgNodeElements.get(to)?.classList.add("filter-match");
		}
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
		// mouseleave) and after each SVG repaint; scrolling there would yank the
		// viewport. Scroll only on actual selection change.
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
	// Coalesce render requests: SSE batches and reactive updates fire often, so debounce to the last settled state before repainting.
	private scheduleRender(): void {
		if (this.renderTimer !== undefined) clearTimeout(this.renderTimer);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			this.renderSvg();
		}, 150);
	}

	private renderSvg(): void {
		const { graph, nodeMap } = buildGraphTopology(this.visibleQuads, this.buildOpts(), this.activeClassifier);
		const source = graphToDot(graph);
		if (source === this.lastSource) return;
		this.lastSource = source;
		this.currentNodeMap = nodeMap;
		this.subjectToRawId = new Map();
		for (const [rawId, v] of nodeMap) this.subjectToRawId.set(v.subject, rawId);
		const host = this.shadowRoot?.getElementById(this.diagramId);
		if (!host) return;
		// Inject into the empty #diagramId leaf, not .diagram-container: that leaf has no template children, so lit never
		// reconciles it and the SVG survives lit re-renders. Preserve the .graph-scroll position across repaints.
		const scroller = this.shadowRoot?.querySelector(".graph-scroll");
		const scrollTop = scroller?.scrollTop ?? 0;
		const scrollLeft = scroller?.scrollLeft ?? 0;
		host.innerHTML = graphToSvg(graph);
		if (scroller) {
			scroller.scrollTop = scrollTop;
			scroller.scrollLeft = scrollLeft;
		}
		this.bindSvg(graph, host);
		this.applyZoom();
	}

	/** Make nodes clickable; highlight a node + its neighbours + incident edges on hover; route clicks. */
	private bindSvg(graph: TGraph, container: Element): void {
		// The dim/highlight CSS keys off `.diagram-container.filter-highlight` (matching highlightRel/paintHighlight);
		// toggle the class on that ancestor, not the injected leaf, or hover has no visible effect.
		const diagram = container.closest(".diagram-container") ?? container;
		const nodeElements = findSvgNodes(graph, container);
		const nodeEdgeElements = findSvgEdges(graph, container);
		const neighbors = buildNeighbors(graph);
		this.svgNodeElements = nodeElements;
		this.svgNodeEdgeElements = nodeEdgeElements;
		this.svgNeighbors = neighbors;
		// A freshly painted SVG has no `.filter-match` classes; reapply a sticky selection highlight.
		if (this.selectedHighlightSubject) this.paintHighlight(this.selectedHighlightSubject);

		for (const [rawId, g] of nodeElements) {
			g.addEventListener("mouseenter", () => {
				diagram.classList.add("filter-highlight");
				g.classList.add("filter-match");
				neighbors.get(rawId)?.forEach((nid) => nodeElements.get(nid)?.classList.add("filter-match"));
				nodeEdgeElements.get(rawId)?.forEach((el) => el.classList.add("filter-match"));
			});
			g.addEventListener("mouseleave", () => this.clearFilterHighlight());

			g.addEventListener("click", (e) => {
				e.stopPropagation();
				if (isSummaryId(rawId)) {
					this.setState({ expandedGraphs: [...new Set([...this.state.expandedGraphs, summaryGraphOf(rawId)])] });
					return;
				}
				const entry = this.currentNodeMap.get(rawId);
				if (!entry) throw new Error(`shu-graph-view: clicked node "${rawId}" has no entry in currentNodeMap — the render and the click handlers are out of sync`);
				// A schema node: a Class that is a registered type opens its type view through the shared hypermedia ref
				// router (a domain reference — the same navigation a #Type link uses). A Property node or an external
				// upper-ontology class (prov:Agent — no registered type) has no type view to open.
				if (isSchemaType(entry.graph)) {
					if (entry.graph === ONTOLOGY_CLASS && getRels(entry.subject)) openRef(this, "domain", { domain: entry.subject });
					return;
				}
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
				// Non-individual graph (no rels registered for the namedGraph). Two shapes reach here:
				//   • seqPath subjects (single-product steps emit the producing seqPath as the subject; multi-product
				//     steps emit `${seqPath}#${field}`) → step-detail pane.
				//   • working-memory variables / goal-affordance bindings carry a recorded producing seqPath quad
				//     → step-detail for that seqPath.
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
