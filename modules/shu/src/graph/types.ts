/**
 * Renderer-agnostic graph shape.
 *
 * Consumed by view-specific projection functions (chain-lint, affordance paths,
 * monitor traces, quad-store visualisations) and rendered by an `IGraphRenderer`
 * implementation. The shape carries no layout information — laying out is the
 * renderer's job.
 *
 * Each node belongs to at most one group. Groups can nest via `groups[g].parent`.
 * Per-kind styling is keyed by `node.kind` and `edge.kind`; renderers ship sensible
 * defaults for a small built-in vocabulary and accept overrides via `styles`.
 *
 * Path-aware views (affordance combined-graph) tag each edge with the path ids it
 * participates in via `edge.paths`; renderers can highlight a subset of paths.
 */

export type TGraphNode = {
	/** Unique within the graph. */
	id: string;
	/** Displayed on the node. */
	label: string;
	/** Semantic marker for styling. Built-in vocabulary: default, satisfied, reachable, unreachable, refused, argument, current. */
	kind?: string;
	/** Group this node belongs to. References a key in `groups`. */
	group?: string;
	/** Optional click target for the consumer to handle. */
	link?: { method?: string; href?: string };
	/**
	 * `hbn:invoke` — this node represents a step the user can run. The
	 * consumer of GRAPH_NODE_CLICK opens the actions-bar for the step.
	 */
	invokes?: { stepperName: string; stepName: string; pathIndex?: number; stepIndex?: number };
	/**
	 * `prov:wasGeneratedBy` — this node represents a fact produced by a
	 * step. `factId` is the producing seqPath (string form). The
	 * consumer opens the step-detail pane for that seqPath.
	 */
	wasGeneratedBy?: { factId: string; domain: string };
};

export type TGraphEdge = {
	/** Source node id. */
	from: string;
	/** Target node id. */
	to: string;
	/** Edge label. */
	label?: string;
	/** Semantic marker for styling. Built-in vocabulary: default, ready, blocked, capability-gated. */
	kind?: string;
	/** Path ids this edge participates in. Used by path-aware highlighting; absent for non-path graphs. */
	paths?: string[];
	/** Stepper and step that produced this edge (for filtering / click routing on chain-style projections). Absent for synthetic edges (fields, ensures). */
	stepperName?: string;
	stepName?: string;
};

export type TGraphGroup = {
	/** Displayed as the group's title. */
	label: string;
	/** Parent group id for nesting. Absent for top-level groups. */
	parent?: string;
	/** Semantic marker for styling. */
	kind?: string;
};

export type TGraphStyle = {
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	/** CSS class name to attach (for renderer-specific styling beyond fill/stroke). */
	className?: string;
};

export type TGraph = {
	nodes: TGraphNode[];
	edges: TGraphEdge[];
	/** Direction hint. Renderer may ignore. */
	direction?: "LR" | "TB" | "RL" | "BT";
	/** Group metadata keyed by group id (which nodes reference via `node.group`). */
	groups?: Record<string, TGraphGroup>;
	/** Style overrides keyed by `kind`. Both node and edge kinds share this namespace. */
	styles?: Record<string, TGraphStyle>;
};

export type TGraphRenderOptions = {
	/** When set, edges with `e.paths?.includes(highlightedPath)` are emphasised; others are dimmed. */
	highlightedPath?: string;
	/** Width and height hints for the rendering container. Renderer may ignore. */
	width?: number;
	height?: number;
};

/**
 * Renderer interface. Implementations: MermaidGraphRenderer (today),
 * server-layout renderer (future).
 *
 * Renderers communicate user interaction by dispatching events on the container:
 *   - `graph-node-click` with `{ detail: { nodeId, node } }` for clicks.
 *
 * Renderers are responsible for clearing the container of any prior rendering
 * before painting; consumers can call `render` repeatedly with new graphs.
 */
export interface IGraphRenderer {
	render(graph: TGraph, container: HTMLElement, options?: TGraphRenderOptions): Promise<void>;
}
