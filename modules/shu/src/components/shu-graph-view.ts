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
import { getStepperForType, getAvailableSteps, requireStep } from "../rpc-registry.js";
import { extractQuadsFromEvents, type TCluster, type TQuad } from "@haibun/core/lib/quad-types.js";
import { buildGraphModelFromQuads } from "../graph-model.js";
import { getJsonCookie, setJsonCookie } from "../cookies.js";
import { getGraphSnapshot, mergeQuadsIntoSnapshot, DEFAULT_PER_TYPE_LIMIT, subscribeViewContext } from "../quads-snapshot.js";
import { ShuGraphFilter } from "./shu-graph-filter.js";
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
	clusters: z
		.array(z.object({ type: z.string(), totalCount: z.number(), sampledCount: z.number(), omittedCount: z.number(), sampledSubjects: z.array(z.string()) }))
		.default([]),
	perTypeLimit: z.number().int().positive().default(DEFAULT_PER_TYPE_LIMIT),
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
.diagram-container .node, .diagram-container .edgeLabel, .diagram-container .cluster, .diagram-container path.flowchart-link { transition: opacity 0.15s; }
.diagram-container path.edge-pattern-dotted { stroke-dasharray: 8 4 !important; stroke-width: 1.5px !important; opacity: 0.7; }
.zoom-label { color: #666; }
.quad-count { color: #888; margin-left: auto; }
.empty { padding: 16px; color: #888; text-align: center; }
.graph-filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 8px; }
.diagram-container.filter-highlight .node, .diagram-container.filter-highlight .cluster { opacity: 0.1; }
.diagram-container.filter-highlight path.flowchart-link, .diagram-container.filter-highlight .edgeLabel { opacity: 0; }
.diagram-container.filter-highlight .filter-match, .diagram-container.filter-highlight .filter-match * { opacity: 1 !important; }
`;

const HIDDEN_GRAPHS_COOKIE = "shu-graph-hidden";

const readHiddenGraphsCookie = (): string[] => getJsonCookie<string[]>(HIDDEN_GRAPHS_COOKIE, []);
const writeHiddenGraphsCookie = (hidden: string[]): void => setJsonCookie(HIDDEN_GRAPHS_COOKIE, hidden);

/**
 * Convert a vertex + its outgoing edges (the shape returned by
 * `getVertexWithEdges`) into the quad shape mermaid + the snapshot consume.
 *
 * One quad per scalar property; one quad per edge (predicate = edge type,
 * object = target id). Underscore-prefixed projections (`_id`, `_links`,
 * etc.) are skipped — those are HATEOAS metadata, not graph data.
 */
function vertexAndEdgesToQuads(label: string, vertex: Record<string, unknown>, edges: Array<{ type: string; target: Record<string, unknown> }>): TQuad[] {
	const subject = String(vertex._id ?? vertex.id ?? vertex["@id"] ?? "");
	if (!subject) return [];
	const timestamp = Date.now();
	const quads: TQuad[] = [];
	for (const [k, v] of Object.entries(vertex)) {
		if (k.startsWith("_") || k === "id") continue;
		if (v === undefined || v === null) continue;
		quads.push({ subject, predicate: k, object: v, namedGraph: label, timestamp });
	}
	for (const e of edges) {
		const targetId = String(e.target?._id ?? e.target?.id ?? e.target?.["@id"] ?? "");
		if (!targetId) continue;
		quads.push({ subject, predicate: e.type, object: targetId, namedGraph: label, timestamp });
	}
	return quads;
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
	/** SVG node rawId → adjacent rawIds. Used by selection highlight to mirror hover behavior. */
	private svgNeighbors = new Map<string, Set<string>>();
	/** Reverse lookup: subject → rawId. Avoids the O(N) scan over `currentNodeMap.entries()` on every selection change. */
	private subjectToRawId = new Map<string, string>();
	/** Currently selected subject pinned via `.filter-match`. Cleared on selection change; reapplied after each mermaid re-render. */
	private selectedHighlightSubject: string | null = null;
	private unsubscribeSnapshot?: () => void;
	/** Subjects already fetched on-demand (clustered → individually loaded). Avoids re-fetching the same subject + edges every time the user re-selects it. */
	private fetchedSubjects = new Set<string>();

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
			clusters: [],
			perTypeLimit: DEFAULT_PER_TYPE_LIMIT,
		});
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
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

		const client = SseClient.for("");

		const initial = ShuGraphFilter.getPersistedFilter();
		await this.refetchSnapshot({ perTypeLimit: initial.perTypeLimit });

		// Snapshot mode: fetch once, no live updates
		if (isSnapshot) return;

		this.unsubscribe = client.onEvent((event) => {
			const quads = extractQuadsFromEvents([event as Record<string, unknown>]);
			if (quads.length > 0) {
				mergeQuadsIntoSnapshot(quads);
				this.setState({ quads: [...this.state.quads, ...quads] });
			}
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

	protected render(): void {
		if (!this.shadowRoot) return;
		this.lastMermaidSource = "";
		const { quads, zoom, layout, maxPerSubgraph } = this.state;

		if (quads.length === 0) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="empty"><shu-spinner></shu-spinner> Loading graph data...</div>`;
			return;
		}

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

		const edgeFilterHtml = sortedRels.length > 0 ? sortedRels.map((rel) => {
			const predicates = [...(relToPredicates.get(rel) ?? [])].sort().join(", ");
			return `<label title="${predicates}"><input type="checkbox" data-rel="${rel}" ${hiddenRelSet.has(rel) ? "" : "checked"}> ${rel}</label>`;
		}).join("") : "";

		this.lastMermaidSource = "";
		// Toolbar drops the standalone "limit <input>" \u2014 the filter row's slider is the
		// single control for per-type sample size. Quad count moves into the filter row
		// (rendered via shu-graph-filter) so settings sit on one line.
		const toolbar = `<div class="toolbar" data-testid="graph-view-toolbar">
			<button data-action="layout">${layout}</button>
			<button data-action="zoom-out">\u2212</button>
			<span class="zoom-label">${zoom}%</span>
			<button data-action="zoom-in">+</button>
			<button data-action="copy">Copy</button>
		</div>
		<shu-graph-filter></shu-graph-filter>
		${edgeFilterHtml ? `<div class="graph-filters" data-testid="graph-predicate-filters">${edgeFilterHtml}</div>` : ""}`;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}${toolbar}
			<div class="graph-scroll">
				<div class="diagram-container" style="transform: scale(${zoom / 100}); transform-origin: top left;">
					<div id="${this.diagramId}"></div>
				</div>
			</div>`;
		const filterEl = this.shadowRoot.querySelector("shu-graph-filter") as ShuGraphFilter | null;
		if (filterEl) {
			if (this.showControls) filterEl.setAttribute("show-controls", "");
			else filterEl.removeAttribute("show-controls");
			// Synthesize cluster entries for any namedGraph that appears in the
			// quads but isn't in the snapshot's clusters list \u2014 otherwise the
			// legend is incomplete relative to what mermaid actually renders.
			const seen = new Set<string>();
			const merged: TCluster[] = [];
			for (const c of this.knownClusters.values()) {
				merged.push(c);
				seen.add(c.type);
			}
			for (const q of this.state.quads) {
				if (seen.has(q.namedGraph)) continue;
				seen.add(q.namedGraph);
				merged.push({ type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [] });
			}
			filterEl.setClusters(merged);
			filterEl.setQuadCount(visibleQuads.length);
		}

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
	 * appearance. The subject string is the vertex id used in the strip's
	 * COLUMN_OPEN / CONTEXT_CHANGE flow; here we resolve it to the SVG raw id
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
	 * If `subject` isn't already in the loaded data — typical when the user
	 * selects a vertex from a query result that the clustered snapshot only
	 * sampled, or when the selected subject's neighbours are still in their
	 * cluster — fetch the vertex + its outgoing edges and merge them into
	 * `state.quads`. The mermaid re-render then includes the subject + linked
	 * targets, and the post-render reapply highlights them.
	 *
	 * Each subject is fetched at most once per view lifetime (`fetchedSubjects`)
	 * so re-selecting the same vertex doesn't repeat the RPC.
	 */
	private async fetchIfMissing(subject: string, label: string): Promise<void> {
		if (this.subjectToRawId.has(subject) || this.fetchedSubjects.has(subject)) return;
		this.fetchedSubjects.add(subject);
		try {
			await getAvailableSteps();
			const client = SseClient.for("");
			const data = await inAction(
				(scope) => client.rpc<{ vertex: Record<string, unknown>; edges: Array<{ type: string; target: Record<string, unknown> }> }>(scope, requireStep("getVertexWithEdges"), { label, id: subject }),
				`graph-view: fetch missing selection ${label}:${subject}`,
			);
			if (!data?.vertex) return;
			const newQuads = vertexAndEdgesToQuads(label, data.vertex, data.edges ?? []);
			if (newQuads.length === 0) return;
			mergeQuadsIntoSnapshot(newQuads);
			// Adding quads is necessary but not sufficient: when the subject's type
			// has more members than `maxPerSubgraph`, buildMermaidSource collapses
			// the whole type into a single `cluster:<label>` node and the subject
			// stays hidden. Explicitly expand the subject's graph so individual
			// vertices in that type render — the user just declared interest in one
			// of them, the rest of the type is now relevant context.
			const expanded = this.state.expandedGraphs.includes(label) ? this.state.expandedGraphs : [...this.state.expandedGraphs, label];
			this.setState({ quads: [...this.state.quads, ...newQuads], expandedGraphs: expanded });
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
			if (container) container.innerHTML = `<pre style="color:red">${err instanceof Error ? err.message : err}</pre>`;
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
		// Reapply selection highlight if we already had a sticky selection: the SVG was just rebuilt and lost any prior `.filter-match` classes.
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
				if (!entry) return;
				if (getRels(entry.graph)) {
					this.dispatchEvent(
						new CustomEvent(SHU_EVENT.COLUMN_OPEN, {
							detail: { label: entry.graph, subject: entry.subject, addToSelection: (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey },
							bubbles: true,
							composed: true,
						}),
					);
				} else {
					this.showQuadDetail(entry.graph, entry.subject);
				}
			});
		}
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
