/**
 * ShuGraph: generic graph visualization web component.
 *
 * Takes a renderer-agnostic `TGraph` via its `products` setter and paints it
 * using an injected `IGraphRenderer`. The default renderer is `SvgGraphRenderer`;
 * a future server-layout renderer can replace it without callers changing.
 *
 * Consumers listen for `SHU_EVENT.GRAPH_NODE_CLICK` to react to node selection.
 * Hover-highlight (immediate neighbours) and selection-highlight (transitive
 * component) are applied via CSS classes against the live SVG; callers drive
 * selection via the `selectedNodeId` property.
 *
 * Stability invariants:
 *  - Zoom is a CSS-only transform on the diagram container. Updating zoom never
 *    triggers a re-layout: the rendered SVG stays put.
 *  - `repaint()` skips `renderer.render()` when the projected graph source is
 *    byte-identical to the previous one, so live updates that don't change the
 *    graph shape don't re-lay it out.
 *  - Selection lives outside the Zod state and applies via CSS classes; toggling
 *    selection does not re-render.
 */
import { html, css, type TemplateResult } from "lit";
import { z } from "zod";
import { ShuElement, type TLinkedData } from "./shu-element.js";
import { shuBaseStyles } from "./styles.js";
import { SHU_EVENT } from "../consts.js";
import { SvgGraphRenderer, graphToDot, findSvgNodes, findSvgEdges } from "../graph/svg-renderer.js";
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
const GraphEdgeSchema = z.object({ from: z.string(), to: z.string(), label: z.string().optional(), kind: z.string().optional(), paths: z.array(z.string()).optional() });
const GraphGroupSchema = z.object({ label: z.string(), parent: z.string().optional(), kind: z.string().optional() });
const GraphStyleSchema = z.object({ fill: z.string().optional(), stroke: z.string().optional(), strokeWidth: z.number().optional(), className: z.string().optional() });
const GraphSchema = z.object({
	nodes: z.array(GraphNodeSchema),
	edges: z.array(GraphEdgeSchema),
	direction: z.enum(["LR", "TB", "RL", "BT"]).optional(),
	groups: z.record(z.string(), GraphGroupSchema).optional(),
	styles: z.record(z.string(), GraphStyleSchema).optional(),
});
const GraphRenderOptionsSchema = z.object({ highlightedPath: z.string().optional(), width: z.number().optional(), height: z.number().optional() });
const ShuGraphSchema = z.object({ graph: GraphSchema.nullable(), options: GraphRenderOptionsSchema.optional() });

export class ShuGraph extends ShuElement<typeof ShuGraphSchema> {
	/** The rendered graph as a collection of nodes and edges. */
	summarizeForKihan(): TLinkedData | null {
		const graph = this.state.graph;
		if (!graph || graph.nodes.length === 0) return null;
		return {
			"@id": "view:graph-2d",
			"@type": "as:Collection",
			name: `a graph of ${graph.nodes.length} nodes and ${graph.edges.length} edges`,
			nodeCount: graph.nodes.length,
			edgeCount: graph.edges.length,
			nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, ...(n.kind ? { kind: n.kind } : {}) })),
			edges: graph.edges.map((e) => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) })),
		};
	}

	static styles = [
		shuBaseStyles,
		css`
		:host { display: block; }
		.copy-strip { display: flex; justify-content: flex-end; padding: var(--shu-space-1) 0 var(--shu-space-2); }
		.scroll { overflow: auto; max-height: 100%; }
		.container { padding: var(--shu-space-4); background: var(--shu-bg-soft); border: var(--shu-border-w) solid var(--shu-border); border-radius: var(--shu-radius); }
		.error { color: var(--shu-error); padding: var(--shu-space-3); background: var(--shu-bg-error-soft); border-radius: var(--shu-radius); font-size: var(--shu-font-md); }
		svg.filter-highlight g.node, svg.filter-highlight g.group { opacity: 0.6; transition: opacity 120ms; }
		svg.filter-highlight g.edge { opacity: 0.35; transition: opacity 120ms; }
		svg.filter-highlight .filter-match, svg.filter-highlight .filter-match * { opacity: 1 !important; }
		svg g.node.selected .node-box { stroke: var(--shu-warn) !important; stroke-width: 4px !important; }
	`,
	];

	private renderer: IGraphRenderer = new SvgGraphRenderer();
	private renderPending = false;
	private zoomPercent = 100;
	private selectedNodeIdValue = "";
	private lastSource = "";
	private svgNodeElements = new Map<string, SVGGElement>();
	private svgNodeEdgeElements = new Map<string, Set<Element>>();
	private svgNeighbors = new Map<string, Set<string>>();

	constructor() {
		super(ShuGraphSchema, { graph: null });
	}

	setRenderer(renderer: IGraphRenderer): void {
		this.renderer = renderer;
		this.lastSource = "";
		void this.repaint();
	}

	set products(p: Record<string, unknown>) {
		this.setState({ graph: p.graph as TGraph, options: p.options as TGraphRenderOptions | undefined });
	}

	get selectedNodeId(): string {
		return this.selectedNodeIdValue;
	}
	set selectedNodeId(id: string) {
		if (id === this.selectedNodeIdValue) return;
		this.selectedNodeIdValue = id;
		this.applySelectionToSvg();
	}

	setZoom(zoom: number): void {
		if (zoom === this.zoomPercent) return;
		this.zoomPercent = zoom;
		const container = this.shadowRoot?.querySelector(".container") as HTMLElement | null;
		if (container) container.style.transform = `scale(${zoom / 100})`;
	}

	getZoom(): number {
		return this.zoomPercent;
	}

	private onContainerClick = (e: Event): void => {
		if (e.target instanceof Element && e.target.closest("g.node")) return;
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: { nodeId: "", node: null }, bubbles: true, composed: true }));
	};

	private onNodeClick = (e: Event): void => {
		e.stopPropagation();
		const ce = e as CustomEvent;
		this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: ce.detail, bubbles: true, composed: true }));
	};

	private onNodeHover = (e: Event): void => {
		e.stopPropagation();
		if (this.selectedNodeIdValue) return;
		const nodeId = (e as CustomEvent).detail?.nodeId as string | undefined;
		if (nodeId) this.paintHighlight(nodeId, false);
	};

	private onNodeLeave = (e: Event): void => {
		e.stopPropagation();
		if (this.selectedNodeIdValue) return;
		this.clearHighlight();
	};

	protected updated(): void {
		void this.repaint();
	}

	render(): TemplateResult {
		return html`
			<div class="copy-strip"><shu-copy-button data-testid="shu-graph-copy" label="Copy" title="Copy graph as DOT"></shu-copy-button></div>
			<div class="scroll"><div class="container" data-testid="shu-graph-container" style=${`transform: scale(${this.zoomPercent / 100}); transform-origin: top left;`}
				@click=${this.onContainerClick}
				@graph-node-click=${this.onNodeClick}
				@graph-node-hover=${this.onNodeHover}
				@graph-node-leave=${this.onNodeLeave}></div></div>`;
	}

	private async repaint(): Promise<void> {
		if (this.renderPending) return;
		this.renderPending = true;
		await Promise.resolve();
		this.renderPending = false;
		const container = this.shadowRoot?.querySelector(".container") as HTMLElement | null;
		const graph = this.state.graph;
		if (!container || !graph) return;
		const source = graphToDot(graph, this.state.options);
		const copyBtn = this.shadowRoot?.querySelector('shu-copy-button[data-testid="shu-graph-copy"]') as (HTMLElement & { source: string }) | null;
		if (copyBtn) copyBtn.source = source;
		if (source === this.lastSource) return;
		this.lastSource = source;
		await this.renderer.render(graph, container, this.state.options);
		this.svgNodeElements = findSvgNodes(graph, container);
		this.svgNodeEdgeElements = findSvgEdges(graph, container);
		this.svgNeighbors = buildNeighbors(graph);
		this.applySelectionToSvg();
	}

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
