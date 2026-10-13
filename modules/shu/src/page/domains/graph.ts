/**
 * Renderer-agnostic graph shape.
 *
 * Consumed by view-specific projection functions (chain-lint, affordance paths), which
 * turn it into quads the site's graph presenter draws (`graph-quads.ts`). The shape
 * doesn't carry layout information, laying out is the presenter's job.
 *
 * Each node is a member of at most one group. Groups can nest via `groups[g].parent`.
 * Styling is keyed by `node.kind` and `edge.kind`.
 *
 * Path-aware views (affordance combined-graph) tag each edge with the ids of the paths
 * that include it, in `edge.paths`.
 */

/** The built-in kinds that style a node. */
export const NODE_KIND = {
	default: "default",
	satisfied: "satisfied",
	reachable: "reachable",
	unreachable: "unreachable",
	refused: "refused",
	argument: "argument",
	current: "current",
	field: "field",
	factInstance: "fact-instance",
	resource: "resource",
	waypointEnsured: "waypoint-ensured",
	waypointDeclarative: "waypoint-declarative",
	waypointImperative: "waypoint-imperative",
} as const;

/** The built-in kinds that style an edge. */
export const EDGE_KIND = { default: "default", ready: "ready", blocked: "blocked", capabilityGated: "capability-gated", context: "context", reply: "reply" } as const;

export type TGraphNode = {
	/** Unique within the graph. */
	id: string;
	/** Displayed on the node. */
	label: string;
	/** Extended detail shown as the node's hover hint (a paint renders it as the SVG title / tooltip); falls back to label+kind. */
	hint?: string;
	/** Semantic marker for styling: one of NODE_KIND, or a data @type. A node that doesn't state one is of NODE_KIND.default (`kindOfNode`). */
	kind?: string;
	/** The group of this node: a key in `groups`. */
	group?: string;
	/** Optional click target for the consumer to handle. */
	link?: { method?: string; href?: string };
	/**
	 * `hbn:invoke`: this node represents a runnable step. The consumer of
	 * GRAPH_NODE_CLICK opens the actions-bar for the step.
	 */
	invokes?: { stepperName: string; stepName: string; pathIndex?: number; stepIndex?: number };
	/**
	 * `prov:wasGeneratedBy`: this node represents a fact produced by a
	 * step. `factId` is the producing seqPath (string form). The
	 * consumer opens the record of the step at that seqPath.
	 */
	wasGeneratedBy?: { factId: string; domain?: string };
};

export type TGraphEdge = {
	/** Source node id. */
	from: string;
	/** Target node id. */
	to: string;
	/** Edge label. */
	label?: string;
	/** Semantic marker for styling: one of EDGE_KIND. An edge that doesn't state one is of EDGE_KIND.default (`kindOfEdge`). */
	kind?: string;
	/** Link relation this edge carries (e.g. "attributedTo", "inReplyTo"); drives relation-filter selection. */
	rel?: string;
	/** The ids of the paths that include this edge. Used by path-aware highlighting; absent for non-path graphs. */
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

/** The node `id` names in `graph`, which `where` names. A node the graph doesn't hold is refused. */
export function nodeIn(graph: TGraph | null | undefined, id: string, where: string): TGraphNode {
	const node = graph?.nodes.find((n) => n.id === id);
	if (!node) throw new Error(`${where} doesn't hold a node "${id}"`);
	return node;
}

export type TGraph = {
	nodes: TGraphNode[];
	edges: TGraphEdge[];
	/** The flow direction a layered layout reads; `directionOf` reads left to right where a graph doesn't state one. */
	direction?: "LR" | "TB" | "RL" | "BT";
	/** Group metadata keyed by group id (which nodes reference via `node.group`). */
	groups?: Record<string, TGraphGroup>;
};

/** A node's kind: the kind it states, or NODE_KIND.default where it doesn't state one. */
export const kindOfNode = (node: TGraphNode): string => (node.kind === undefined ? NODE_KIND.default : node.kind);

/** An edge's kind: the kind it states, or EDGE_KIND.default where it doesn't state one. */
export const kindOfEdge = (edge: TGraphEdge): string => (edge.kind === undefined ? EDGE_KIND.default : edge.kind);

/** A graph's flow direction: the direction it states, or left to right where it doesn't state one. */
export const directionOf = (graph: TGraph): NonNullable<TGraph["direction"]> => (graph.direction === undefined ? "LR" : graph.direction);
