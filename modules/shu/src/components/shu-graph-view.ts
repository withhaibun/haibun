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
import mermaid from "mermaid";
import { ShuElement } from "./shu-element.js";
import { conduit } from "../hypermedia.js";
import { SHU_EVENT } from "../consts.js";
import { parseSeqPath } from "@haibun/core/lib/seq-path.js";
import { PaneState } from "../pane-state.js";
import { getEdgeRanges, getEdgeRelMap, getRels } from "../rels-cache.js";
import { getStepperForType, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { extractQuadsFromEvents, type TCluster, type TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "../graph-model.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { getGraphSnapshot, mergeQuadsIntoSnapshot, currentSnapshot, DEFAULT_PER_TYPE_LIMIT, subscribeViewContext } from "../quads-snapshot.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
import { edgeRel as coreEdgeRel, LinkRelations } from "@haibun/core/lib/resources.js";
import { appAccessLevel, idOf } from "../util.js";
import { buildMermaidSource, buildClassifier, THREAD_CLASSIFIER, DEFAULT_MAX_PER_SUBGRAPH, type TGraphViewOpts, type PropertyClassifier } from "../mermaid-source.js";

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
	clusters: z.array(z.object({ type: z.string(), totalCount: z.number(), sampledCount: z.number(), omittedCount: z.number(), sampledSubjects: z.array(z.string()) })).default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
});

const HIDDEN_GRAPHS_COOKIE = "shu-graph-hidden";

const readHiddenGraphsCookie = (): string[] => getJsonCookie<string[]>(HIDDEN_GRAPHS_COOKIE, []);
const writeHiddenGraphsCookie = (hidden: string[]): void => setJsonCookie(HIDDEN_GRAPHS_COOKIE, hidden);

/**
 * Convert an individual + its outgoing edges (the shape returned by
 * `getIndividualWithEdges`) into the quad shape mermaid + the snapshot consume.
 *
 * One quad per scalar property; one quad per edge (predicate = edge type,
 * object = target id). JSON-LD keywords (`@id`, `@type`) and underscore-prefixed
 * projections (`_links`, etc.) are skipped — identity, type, and HATEOAS
 * metadata, not graph-property data.
 */
function vertexAndEdgesToQuads(label: string, vertex: Record<string, unknown>, edges: Array<{ type: string; target: Record<string, unknown> }>): TQuad[] {
	const subject = idOf(vertex);
	if (!subject) return [];
	const timestamp = Date.now();
	const quads: TQuad[] = [];
	for (const [k, v] of Object.entries(vertex)) {
		if (k.startsWith("_") || k.startsWith("@") || k === "id") continue;
		if (v === undefined || v === null) continue;
		quads.push({ subject, predicate: k, object: v, namedGraph: label, timestamp });
	}
	for (const e of edges) {
		const targetId = idOf(e.target);
		if (!targetId) continue;
		quads.push({ subject, predicate: e.type, object: targetId, namedGraph: label, timestamp });
	}
	return quads;
}

export class ShuGraphView extends ShuElement<typeof StateSchema> {
	static styles = [shuBaseStyles, css`
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
	`];
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
	/** SVG node rawId → adjacent rawIds. Used by selection highlight to mirror hover behavior. */
	private svgNeighbors = new Map<string, Set<string>>();
	/** Reverse lookup: subject → rawId. Avoids the O(N) scan over `currentNodeMap.entries()` on every selection change. */
	private subjectToRawId = new Map<string, string>();
	/** Currently selected subject pinned via `.filter-match`. Cleared on selection change; reapplied after each mermaid re-render. */
	private selectedHighlightSubject: string | null = null;
	private unsubscribeSnapshot?: () => void;
	/** Subjects already fetched on-demand (clustered → individually loaded). Avoids re-fetching the same subject + edges on re-selection. */
	private fetchedSubjects = new Set<string>();

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
			clusters: [],
			perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
		});
	}

	protected override async onConnected(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		this.addEventListener(SHU_EVENT.GRAPH_FILTER_CHANGE, ((e: CustomEvent<{ types: string[]; perTypeLimit: number }>) => {
			const visible = new Set(e.detail.types);
			// Hidden = all known namedGraphs minus visible. The set is the union of
			// `knownClusters` (snapshot-reported clusters) and live namedGraphs from
			// `state.quads` — types that arrived only via SSE/on-demand fetch
			// otherwise wouldn't appear here, and unchecking them in the filter
			// would have no effect.
			const allKnown = new Set<string>(this.knownClusters.keys());
			for (const q of this.state.quads) allKnown.add(q.namedGraph);
			const hiddenGraphs = [...allKnown].filter((t) => !visible.has(t));
			writeHiddenGraphsCookie(hiddenGraphs);
			this.setState({ hiddenGraphs });
			void this.refetchSnapshot({ types: e.detail.types, perTypeLimit: e.detail.perTypeLimit });
		}) as EventListener);
		this.addEventListener(SHU_EVENT.GRAPH_CLUSTER_EXPAND, (() => {
			const nextLimit = Math.max(this.state.perTypeLimit * 2, this.state.perTypeLimit + 100);
			const hidden = new Set(this.state.hiddenGraphs);
			const visibleTypes = [...this.knownClusters.keys()].filter((t) => !hidden.has(t));
			void this.refetchSnapshot({ types: visibleTypes.length > 0 ? visibleTypes : undefined, perTypeLimit: nextLimit });
		}) as EventListener);

		// External mode: data provided via setQuads, skip RPC and SSE.
		if (this.state.dataSource === "external") return;
		const isSnapshot = this.hasAttribute("data-snapshot-time");

		const initial = ShuGraphFilter.getPersistedFilter();
		await this.refetchSnapshot({ perTypeLimit: initial.perTypeLimit });

		// Snapshot mode: fetch once, no live updates
		if (isSnapshot) return;

		this.unsubscribe = this.subscribeBatched({
			onBatch: (events) => {
				const quads = extractQuadsFromEvents(events);
				if (quads.length === 0) return;
				mergeQuadsIntoSnapshot(quads);
				this.syncFromSnapshot();
			},
		});

		this.unsubscribeSnapshot = subscribeViewContext({
			onSelectionChange: (subject, label) => {
				this.applySelectionHighlight(subject);
				if (subject && label) void this.fetchIfMissing(subject, label);
			},
		});

		// Empty-area click in the diagram releases the focus lock. Bound on the
		// shadow root once (delegated) so each mermaid re-render doesn't append
		// another listener.
		this.shadowRoot?.addEventListener("click", (e) => {
			if (e.defaultPrevented) return;
			const target = e.target as Element | null;
			if (!target?.closest(".diagram-container")) return;
			if (target.closest("g.node, g.cluster")) return;
			this.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail: { patterns: [] }, bubbles: true, composed: true }));
		});
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
			void this.renderMermaid();
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

	protected override onDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribeSnapshot?.();
	}

	private knownClusters = new Map<string, TCluster>();

	private async refetchSnapshot(opts: { perTypeLimit: number; types?: string[] }): Promise<void> {
		try {
			const snap = await getGraphSnapshot({ perTypeLimit: opts.perTypeLimit, types: opts.types, forceRefresh: true });
			for (const c of snap.clusters) this.knownClusters.set(c.type, c);
			// Subjects fetched on demand (fetchIfMissing) are now part of the fresh
			// snapshot; clearing here keeps the set bounded across long sessions
			// and lets a subject re-load if it was sampled out by a new perTypeLimit.
			this.fetchedSubjects.clear();
			this.setState({ quads: snap.quads, clusters: snap.clusters, perTypeLimit: opts.perTypeLimit });
		} catch {
			/* stepper may not be loaded */
		}
	}

	/** Set the render quads + clusters from the shared snapshot; `extra` merges sibling state in the same update. */
	private syncFromSnapshot(extra: Partial<z.infer<typeof StateSchema>> = {}): void {
		const snap = currentSnapshot();
		for (const c of snap.clusters) this.knownClusters.set(c.type, c);
		this.setState({ quads: snap.quads, clusters: snap.clusters, ...extra });
	}

	render(): TemplateResult {
		this.lastMermaidSource = "";
		const { quads, zoom, layout } = this.state;

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

		this.lastMermaidSource = "";
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
				<div class="diagram-container" style=${`transform: scale(${zoom / 100}); transform-origin: top left;`}>
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
		void this.renderMermaid();
	}

	private onToolbarClick(e: Event): void {
		const action = (e.currentTarget as HTMLElement).dataset.action;
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
		return {
			layout: this.state.layout,
			hiddenGraphs: new Set(this.state.hiddenGraphs),
			expandedGraphs: new Set(this.state.expandedGraphs),
			maxPerSubgraph: this.state.maxPerSubgraph,
			hiddenRels: new Set(this.state.hiddenRels),
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
	 * If `subject` isn't already in the loaded data — typical for a node selected
	 * from a query result that the clustered snapshot only sampled, or when the
	 * selected subject's neighbours are still in their cluster — fetch the node +
	 * its outgoing edges and merge them into `state.quads`. The mermaid re-render
	 * then includes the subject + linked targets, and the post-render reapply
	 * highlights them.
	 *
	 * Each subject is fetched at most once per view lifetime (`fetchedSubjects`)
	 * so re-selecting the same node doesn't repeat the RPC.
	 */
	private async fetchIfMissing(subject: string, label: string): Promise<void> {
		if (this.subjectToRawId.has(subject) || this.fetchedSubjects.has(subject)) return;
		// `getIndividualWithEdges` only accepts registered individual labels. Named graphs
		// that carry quads but aren't individual types — `facts`, `observation/*`,
		// `variables` — have no rels in the rels cache. Skip the RPC; the click
		// handler routes seqPath subjects to `step-detail` and the rest to
		// `CONTEXT_CHANGE` directly.
		if (!getRels(label)) return;
		this.fetchedSubjects.add(subject);
		try {
			await getAvailableSteps();
			const data = await conduit().follow<{ vertex: Record<string, unknown>; edges: Array<{ type: string; target: Record<string, unknown> }> }>(
				{ method: requireStep("getIndividualWithEdges"), params: { label, id: subject, accessLevel: appAccessLevel() } },
				`graph-view: fetch missing selection ${label}:${subject}`,
			);
			if (!data?.vertex) return;
			const newQuads = vertexAndEdgesToQuads(label, data.vertex, data.edges ?? []);
			if (newQuads.length === 0) return;
			mergeQuadsIntoSnapshot(newQuads);
			// Expand the subject's graph so its individual nodes render instead of staying folded inside a collapsed cluster:<label> node.
			const expanded = this.state.expandedGraphs.includes(label) ? this.state.expandedGraphs : [...this.state.expandedGraphs, label];
			this.syncFromSnapshot({ expandedGraphs: expanded });
		} catch {
			this.fetchedSubjects.delete(subject); // allow retry on next selection
		}
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

	private async renderMermaid(): Promise<void> {
		if (!mermaidInitialized) {
			mermaid.initialize({
				startOnLoad: false,
				theme: "default",
				securityLevel: "loose",
				fontFamily: "ui-sans-serif, system-ui, sans-serif",
				maxTextSize: 1_000_000,
				maxEdges: 5000,
				flowchart: { htmlLabels: true },
			});
			mermaidInitialized = true;
		}
		const { source, nodeMap } = buildMermaidSource(this.visibleQuads, this.buildOpts(), this.activeClassifier);
		if (source === this.lastMermaidSource) return;
		this.lastMermaidSource = source;
		this.currentNodeMap = nodeMap;
		this.subjectToRawId = new Map();
		for (const [rawId, v] of nodeMap) this.subjectToRawId.set(v.subject, rawId);
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
			if (container) container.innerHTML = `<pre style="color:var(--shu-error)">${err instanceof Error ? err.message : err}</pre>`;
		}
	}

	/** Parse a mermaid flowchart-link path ID into its edge key and from/to node IDs.
	 *  Path IDs have the form `prefix-L_from_to_index`. Returns null if not parseable. */
	private static parseEdgePathId(pid: string, knownNodes: Set<string>): { pathIdent: string; from: string; to: string } | null {
		const lIdx = pid.indexOf("-L_");
		if (lIdx < 0) return null;
		const pathIdent = pid.slice(lIdx + 1);
		const body = pathIdent.slice(2, pathIdent.lastIndexOf("_"));
		for (let i = 1; i < body.length; i++) {
			if (body[i] !== "_") continue;
			const from = body.slice(0, i);
			const to = body.slice(i + 1);
			if (knownNodes.has(from) && knownNodes.has(to)) return { pathIdent, from, to };
		}
		return null;
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

		// Pass 2: build adjacency + collect edge elements per node.
		// Mermaid v11: edge paths (path.flowchart-link) and edge labels (.edgeLabels > .edgeLabel)
		// have no IDs linking them — they correspond by position (nth path ↔ nth label).
		const neighbors = new Map<string, Set<string>>();
		const nodeEdgeElements = new Map<string, Set<Element>>();
		const edgePaths = Array.from(svg.querySelectorAll("path.flowchart-link"));
		const edgeLabelEls = Array.from(svg.querySelectorAll(".edgeLabels > .edgeLabel"));
		this.svgEdges = [];

		// Build a map from path index to parsed edge info (only for edges between known nodes)
		let labelIdx = 0;
		for (const path of edgePaths) {
			const parsed = ShuGraphView.parseEdgePathId(path.getAttribute("id") ?? "", allNodeIds);
			// Every path.flowchart-link has a corresponding label at the same index
			const labelEl = edgeLabelEls[labelIdx] ?? null;
			labelIdx++;
			if (!parsed) continue;
			const { from, to } = parsed;
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
		}

		// Promote maps to instance properties for use by filter hover handlers
		this.svgNodeElements = nodeElements;
		this.svgNodeEdgeElements = nodeEdgeElements;
		this.svgNeighbors = neighbors;
		// The rebuilt SVG lost any prior `.filter-match` classes; reapply a sticky selection highlight.
		if (this.selectedHighlightSubject) this.paintHighlight(this.selectedHighlightSubject);

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
