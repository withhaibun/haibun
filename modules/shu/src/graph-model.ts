import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";

export type GraphNode = { id: string; type: string; isCluster?: boolean; omittedCount?: number; displayLabel?: string; properties?: Record<string, unknown> };
export type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Node property carrying the resolved HypermediaRole — the id of the party (a `prov:Agent`/Principal) the node is attributed to. Folded from the node's role edges (see `roleRels`); the fisheye's role grouping axis reads it. */
export const HYPERMEDIA_ROLE_KEY = "hypermediaRole";

type BuildGraphModelOptions = {
	ignoreInternalPredicates?: boolean;
	requireObjectSubject?: boolean;
	requireObjectType?: boolean;
	clusters?: TCluster[];
	/** Predicates (priority order) whose target is the node's HypermediaRole. When set, each node's role is folded onto `properties[HYPERMEDIA_ROLE_KEY]` so a pure group-key selector can read it without re-walking edges. */
	roleRels?: readonly string[];
};

const DEFAULT_OPTIONS: Required<Pick<BuildGraphModelOptions, "ignoreInternalPredicates" | "requireObjectSubject" | "requireObjectType">> = {
	ignoreInternalPredicates: true,
	requireObjectSubject: true,
	requireObjectType: true,
};

export const CLUSTER_PREDICATE = "clusterOf";

export function clusterId(type: string): string {
	return `cluster:${type}`;
}

/**
 * Build a normalized graph model from quads. When `clusters` are provided,
 * a cluster node is emitted per type with `omittedCount > 0`, plus a
 * `clusterOf` edge from the cluster node to each sampled sibling so the
 * cluster sits inside its type's neighborhood under force layout.
 */
export function buildGraphModelFromQuads(quads: TQuad[], options: BuildGraphModelOptions = {}): GraphModel {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const nodeMap = new Map<string, GraphNode>();
	for (const q of quads) {
		if (typeof q.subject !== "string" || q.subject.length === 0) continue;
		let node = nodeMap.get(q.subject);
		if (!node) {
			node = { id: q.subject, type: q.namedGraph };
			nodeMap.set(q.subject, node);
		}
		// Carry the node's LITERAL properties (a value, not a typed edge, not an internal/JSON-LD key) so paints can read
		// per-node data (image, dates, coordinates, …) the renderer-agnostic edge model otherwise drops. Edges (objectType
		// set) and internal/@ keys are excluded; the last value for a repeated predicate wins.
		if (q.objectType === undefined && typeof q.object !== "object" && q.object != null && !q.predicate.startsWith("_") && !q.predicate.startsWith("@")) {
			(node.properties ??= {})[q.predicate] = q.object;
		}
	}

	const edges: GraphEdge[] = [];
	for (const q of quads) {
		if (typeof q.subject !== "string" || typeof q.object !== "string") continue;
		if (q.subject === q.object) continue;
		// An edge is a TYPED reference: the quad carries `objectType` — the JSON-LD range of its target. A plain-string
		// property (no objectType) is never an edge, even if its value coincidentally matches a node id. This is the
		// same rule the overview's property classifier applies ("declared by the range, never guessed from the id");
		// guessing is what mis-linked string properties like `account` onto whatever node shared their value.
		if (opts.requireObjectType && (typeof q.objectType !== "string" || q.objectType.length === 0)) continue;
		if (opts.ignoreInternalPredicates && q.predicate.startsWith("_")) continue;
		if (!nodeMap.has(q.subject)) continue;
		if (opts.requireObjectSubject && !nodeMap.has(q.object)) continue;
		edges.push({ from: q.subject, to: q.object, predicate: q.predicate, graph: q.namedGraph });
	}

	if (options.clusters?.length) {
		// The cluster's server-computed displayLabels are the sole source of a node's title.
		for (const c of options.clusters) {
			for (const [subject, label] of Object.entries(c.displayLabels)) {
				const node = nodeMap.get(subject);
				if (node) node.displayLabel = label;
			}
		}
		for (const c of options.clusters) {
			if (c.omittedCount <= 0) continue;
			const cid = clusterId(c.type);
			nodeMap.set(cid, { id: cid, type: c.type, isCluster: true, omittedCount: c.omittedCount });
			for (const sampledSubject of c.sampledSubjects) {
				if (!nodeMap.has(sampledSubject)) continue;
				edges.push({ from: cid, to: sampledSubject, predicate: CLUSTER_PREDICATE, graph: c.type });
			}
		}
	}

	if (opts.roleRels?.length) {
		// Fold each node's HypermediaRole (the party it is attributed to) onto the node, taking the highest-priority role
		// edge, so the role grouping axis is a pure node read. Single-source: the model carries it, no second store.
		const outByFrom = new Map<string, GraphEdge[]>();
		for (const e of edges) {
			const list = outByFrom.get(e.from);
			if (list) list.push(e);
			else outByFrom.set(e.from, [e]);
		}
		for (const node of nodeMap.values()) {
			const out = outByFrom.get(node.id);
			if (!out) continue;
			for (const rel of opts.roleRels) {
				const e = out.find((x) => x.predicate === rel);
				if (e) {
					(node.properties ??= {})[HYPERMEDIA_ROLE_KEY] = e.to;
					break;
				}
			}
		}
	}

	const dedup = new Map<string, GraphEdge>();
	for (const e of edges) dedup.set(`${e.graph}|${e.from}|${e.predicate}|${e.to}`, e);
	return { nodes: Array.from(nodeMap.values()), edges: Array.from(dedup.values()) };
}
