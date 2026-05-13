/**
 * ShuGraph — generic graph visualization web component.
 *
 * Takes a renderer-agnostic `TGraph` via its `products` setter and paints it
 * using an injected `IGraphRenderer`. The default renderer is `MermaidGraphRenderer`;
 * a future server-layout renderer can replace it without callers changing.
 *
 * Consumers listen for `SHU_EVENT.GRAPH_NODE_CLICK` (`graph-node-click`) on
 * either this element or the renderer's container to react to node selection.
 * The component re-renders on every `products` assignment so chain-walker step
 * advances can repaint without remounting.
 *
 * The component is consumer-agnostic: it does not know whether the graph
 * represents a domain chain, a quad store, an affordance combined-graph, or
 * anything else. View-specific projection happens in the calling component.
 */
import { z } from "zod";
import { ShuElement } from "./shu-element.js";
import { SHU_EVENT } from "../consts.js";
import { MermaidGraphRenderer } from "../graph/mermaid-renderer.js";
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

	constructor() {
		super(ShuGraphSchema, { graph: null });
	}

	/**
	 * Inject a custom renderer (e.g. a server-layout renderer). Defaults to
	 * `MermaidGraphRenderer`. Setting this repaints the current graph.
	 */
	setRenderer(renderer: IGraphRenderer): void {
		this.renderer = renderer;
		void this.repaint();
	}

	/**
	 * View-open contract: producing step's products carry `{graph, options?}`.
	 * Re-renders on every assignment so chain-walker advances repaint cleanly.
	 */
	set products(p: Record<string, unknown>) {
		this.setState({ graph: p.graph as TGraph, options: p.options as TGraphRenderOptions | undefined });
	}

	protected render(): void {
		if (!this.shadowRoot) return;
		this.shadowRoot.innerHTML = `${this.css(STYLES)}<div class="container" data-testid="shu-graph-container"></div>`;
		const container = this.shadowRoot.querySelector(".container") as HTMLElement;
		container.addEventListener(SHU_EVENT.GRAPH_NODE_CLICK as string, (e) => {
			e.stopPropagation();
			const ce = e as CustomEvent;
			this.dispatchEvent(new CustomEvent(SHU_EVENT.GRAPH_NODE_CLICK, { detail: ce.detail, bubbles: true, composed: true }));
		});
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
		await this.renderer.render(graph, container, this.state.options);
	}
}

const STYLES = `
	:host { display: block; }
	.container { padding: 8px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; overflow: auto; }
	.error { color: #a02828; padding: 6px; background: #fdecec; border-radius: 3px; font-size: 12px; }
`;
