/**
 * ShuGraph — generic graph visualization web component.
 *
 * Takes a renderer-agnostic `TGraph` via its `products` setter and paints it
 * using an injected `IGraphRenderer`. The default renderer is `MermaidGraphRenderer`;
 * a future server-layout renderer can replace it without callers changing.
 *
 * Consumers listen for `SHU_EVENT.GRAPH_NODE_CLICK` (`graph-node-click`) to react
 * to node selection. The component handles hover-highlight (immediate neighbours)
 * and selection-highlight (transitive component) on its own using the renderer's
 * `graph-node-hover` / `graph-node-leave` events; callers drive selection via
 * the `selectedNodeId` property so the URL / pane state can stay in sync.
 *
 * Stability invariants:
 *  - Zoom is a CSS-only transform on the diagram container. Updating zoom never
 *    triggers a mermaid re-layout — the rendered SVG stays put.
 *  - `repaint()` skips `renderer.render()` when the projected mermaid source is
 *    byte-identical to the previous one, so live affordances updates that don't
 *    change the graph shape don't re-lay it out.
 *  - Selection lives outside the Zod state and applies via CSS classes; toggling
 *    selection does not re-render.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { MermaidGraphRenderer, buildMermaidSource, findSvgNodes, findSvgEdges } from "../graph/mermaid-renderer.js";
import { buildNeighbors, connectedNodes } from "../graph/filter-graph.js";
import type { IGraphRenderer, TGraph, TGraphRenderOptions } from "../graph/types.js";

const GraphNodeSchema = z.object({
	id: z.string(),
	label: z.string(),
	kind: z.string().optional(),
	group: z.string().optional(),
	link: z.object({ method: z.string().optional(), href: z.string().optional() }).optional(),
	invokes: z.object({ stepperName: z.string(), stepName: z.string(), pathIndex: z.number().optional(), stepIndex: z.number().optional() }).optional(),
	wasGeneratedBy: z.object({ factId: z.string(), domain: z.string() }).optional(),
});

const GraphEdgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	label: z.string().optional(),
	kind: z.string().optional(),
	paths: z.array(z.string()).optional(),
});

const GraphGroupSchema = z.object({
	label: z.string(),
	parent: z.string().optional(),
	kind: z.string().optional(),
});

const GraphStyleSchema = z.object({
	fill: z.string().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	className: z.string().optional(),
});

const GraphSchema = z.object({
	nodes: z.array(GraphNodeSchema),
	edges: z.array(GraphEdgeSchema),
	direction: z.enum(["LR", "TB", "RL", "BT"]).optional(),
	groups: z.record(z.string(), GraphGroupSchema).optional(),
	styles: z.record(z.string(), GraphStyleSchema).optional(),
});

const GraphRenderOptionsSchema = z.object({
	highlightedPath: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
});

const ShuGraphSchema = z.object({
	graph: GraphSchema.nullable(),
	options: GraphRenderOptionsSchema.optional(),
});

export class ShuGraph extends ShuElement<typeof ShuGraphSchema> {
	private renderer: IGraphRenderer = new MermaidGraphRenderer();
	private renderPending = false;
	/** UI-only zoom percentage. Lives outside Zod state so changing it never triggers
	 * a re-render — the CSS transform on `.container` updates directly. */
	private zoomPercent = 100;
	/** UI-only selection — sits outside the Zod state so toggling it doesn't trigger
	 * a re-render (which would re-run mermaid layout and shift the graph). Applied
	 * as CSS classes to the existing SVG via `applySelectionToSvg`. */
	private selectedNodeIdValue = "";
	/** Byte-identical-source guard. mermaid.render is O(n²)-ish on large graphs and
	 * resets scroll/zoom on every paint, so live affordance updates that don't change
	 * the projection must not retrigger it. */
	private lastMermaidSource = "";
	/** Per-paint caches so hover / selection handlers don't re-walk the SVG on every event. */
	private svgNodeElements = new Map<string, SVGGElement>();
	private svgNodeEdgeElements = new Map<string, Set<Element>>();
	private svgNeighbors = new Map<string, Set<string>>();

	constructor() {
		super(ShuGraphSchema, { graph: null });
	}

	/**
	 * Inject a custom renderer (e.g. a server-layout renderer). Defaults to
	 * `MermaidGraphRenderer`. Setting this repaints the current graph.
	 */
	setRenderer(renderer: IGraphRenderer): void {
		this.renderer = renderer;
		this.lastMermaidSource = "";
		void this.repaint();
	}

	/**
	 * View-open contract: producing step's products carry `{graph, options?}`.
	 * Re-renders on every assignment so chain-walker advances repaint cleanly.
	 */
	set products(p: Record<string, unknown>) {
		this.setState({ graph: p.graph as TGraph, options: p.options as TGraphRenderOptions | undefined });
	}

	/** Currently selected node id. Setting it applies the selection / transitive-highlight
	 * classes to the existing SVG without re-running layout. */
	get selectedNodeId(): string {
		return this.selectedNodeIdValue;
	}
	set selectedNodeId(id: string) {
		if (id === this.selectedNodeIdValue) return;
		this.selectedNodeIdValue = id;
		this.applySelectionToSvg();
	}

	/** Zoom percentage (100 = 1x). Updates the diagram-container CSS transform directly —
	 * no re-render, no mermaid relayout. */
	setZoom(zoom: number): void {
		if (zoom === this.zoomPercent) return;
		this.zoomPercent = zoom;
		const container = this.shadowRoot?.querySelector(".container") as HTMLElement | null;
		if (container) container.style.transform = `scale(${zoom / 100})`;
	}

	getZoom(): number {
		return this.zoomPercent;
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		// Build the shadow-DOM scaffold (copy strip + container) once. Subsequent renders
		// only repaint the mermaid SVG; rebuilding innerHTML on every setState would wipe
		// the SVG and force mermaid to re-lay-out, defeating the byte-identical-source guard.
		if (!this.shadowRoot.querySelector(".container")) {
			this.shadowRoot.innerHTML = `${this.css(STYLES)}
				<div class="copy-strip"><shu-copy-button data-testid="shu-graph-copy" label="Copy" title="Copy Mermaid source to clipboard"></shu-copy-button></div>
				<div class="scroll"><div class="container" data-testid="shu-graph-container" style="transform: scale(${this.zoomPercent / 100}); transform-origin: top left;"></div></div>`;
			const container = this.shadowRoot.querySelector(".container") as HTMLElement;
			container.addEventListener(SHU_EVENT.GRAPH_NODE_CLICK as string, (e) => {
				e.stopPropagation();
				const ce = e as CustomEvent;
				this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: ce.detail, bubbles: true, composed: true }));
			});
			container.addEventListener(SHU_EVENT.GRAPH_NODE_HOVER as string, (e) => {
				e.stopPropagation();
				if (this.selectedNodeIdValue) return;
				const nodeId = (e as CustomEvent).detail?.nodeId as string | undefined;
				if (nodeId) this.paintHighlight(nodeId, false);
			});
			container.addEventListener(SHU_EVENT.GRAPH_NODE_LEAVE as string, (e) => {
				e.stopPropagation();
				if (this.selectedNodeIdValue) return;
				this.clearHighlight();
			});
			container.addEventListener("click", (e) => {
				if (e.target instanceof Element && e.target.closest("g.node")) return;
				this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { nodeId: "", node: null }, bubbles: true, composed: true }));
			});
		}
		void this.repaint();
	}

	private async repaint(): Promise<void> {
		if (this.renderPending) return;
		this.renderPending = true;
		await Promise.resolve();
		this.renderPending = false;
		if (!this.shadowRoot) return;
		const container = this.shadowRoot.querySelector(".container") as HTMLElement | null;
		const graph = this.state.graph;
		if (!container || !graph) return;
		const source = buildMermaidSource(graph, this.state.options);
		const copyBtn = this.shadowRoot.querySelector('shu-copy-button[data-testid="shu-graph-copy"]') as (HTMLElement & { source: string }) | null;
		if (copyBtn) copyBtn.source = source;
		// Skip the mermaid layout if the projected source is identical to the last paint —
		// avoids re-laying-out on live affordance pings that don't change graph shape.
		if (source === this.lastMermaidSource) return;
		this.lastMermaidSource = source;
		await this.renderer.render(graph, container, this.state.options);
		this.svgNodeElements = findSvgNodes(graph, container);
		this.svgNodeEdgeElements = findSvgEdges(graph, container);
		this.svgNeighbors = buildNeighbors(graph);
		this.applySelectionToSvg();
	}

	/** Paint a focus highlight. `transitive` walks the whole connected component (selection);
	 * otherwise only immediate neighbours (hover). */
	private paintHighlight(rawId: string, transitive: boolean): void {
		const svg = this.shadowRoot?.querySelector(".container svg");
		if (!svg) return;
		svg.classList.add("filter-highlight");
		const ids = transitive ? connectedNodes(this.svgNeighbors, rawId) : new Set<string>([rawId, ...(this.svgNeighbors.get(rawId) ?? [])]);
		for (const id of ids) {
			this.svgNodeElements.get(id)?.classList.add("filter-match");
			this.svgNodeEdgeElements.get(id)?.forEach((el) => el.classList.add("filter-match"));
		}
	}

	private clearHighlight(): void {
		const svg = this.shadowRoot?.querySelector(".container svg");
		if (!svg) return;
		svg.classList.remove("filter-highlight");
		for (const el of Array.from(svg.querySelectorAll(".filter-match"))) el.classList.remove("filter-match");
	}

	/** Apply current `selectedNodeIdValue` to the existing SVG: clear prior selection /
	 * highlight, then paint the new one with transitive-neighbour focus. */
	private applySelectionToSvg(): void {
		const svg = this.shadowRoot?.querySelector(".container svg");
		if (!svg) return;
		for (const el of Array.from(svg.querySelectorAll(".selected"))) el.classList.remove("selected");
		this.clearHighlight();
		const id = this.selectedNodeIdValue;
		if (!id) return;
		const target = this.svgNodeElements.get(id);
		if (!target) return;
		target.classList.add("selected");
		this.paintHighlight(id, true);
	}
}

const STYLES = `
	:host { display: block; }
	/* The copy strip is a single per-graph control. It lives outside the view-controls
	   block because every graph (chain view, affordances goal-graph, future renderers)
	   benefits from "copy the mermaid source" without being part of the view's gear-gated
	   controls. Consumers that want to suppress it can hide via host CSS. */
	.copy-strip { display: flex; justify-content: flex-end; padding: 2px 0 4px; }
	.scroll { overflow: auto; max-height: 100%; }
	.container { padding: 8px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; }
	.error { color: #a02828; padding: 6px; background: #fdecec; border-radius: 3px; font-size: 12px; }
	/* Hover / select emphasis. Unmatched nodes stay visible at a softer opacity so all
	   viable paths remain on screen — selection is for focus, not for filtering. Only
	   the selected node gets the amber border highlight; connected matches keep full
	   opacity but no other treatment. No drop-shadows anywhere. */
	svg.filter-highlight .node, svg.filter-highlight .cluster { opacity: 0.6; transition: opacity 120ms; }
	svg.filter-highlight path.flowchart-link, svg.filter-highlight .edgeLabel { opacity: 0.35; transition: opacity 120ms; }
	svg.filter-highlight .filter-match, svg.filter-highlight .filter-match * { opacity: 1 !important; }
	svg .selected > rect, svg .selected > polygon, svg .selected > circle, svg .selected > ellipse, svg .selected > path { stroke: #a16207 !important; stroke-width: 4px !important; }
`;
