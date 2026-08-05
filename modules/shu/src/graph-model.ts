import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";

export type GraphNode = { id: string; type: string; isCluster?: boolean; omittedCount?: number; displayLabel?: string; properties?: Record<string, unknown> };
export type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Node property carrying the resolved HypermediaRole — the id of the party (a `prov:Agent`/Principal) the node is attributed to. Folded from the node's role edges (see `roleRels`); the fisheye's role grouping axis reads it. */
export const HYPERMEDIA_ROLE_KEY = "hypermediaRole";

/** Node property carrying a party's own role predicate — the highest-priority role rel (a `fromActor`/`toActor`, see `roleRels`) by which other nodes attribute to it. A party is one node; the role it plays is relational (it is the target of a role edge), so this reads from the incoming role edges, not the node's `@type`. A display site maps this predicate to the party's role designation. */
export const HYPERMEDIA_ROLE_REL_KEY = "hypermediaRoleRel";

/** Node property carrying the site principal of the instance whose store SERVED the node — a read-time store fact stamped at the federation merge, never persisted data (and distinct from HAIBUN_SITE_KEY, the env override for this instance's OWN principal). The fisheye's site grouping axis reads it. */
export const SITE_KEY = "site";

type BuildGraphModelOptions = {
	ignoreInternalPredicates?: boolean;
	requireObjectSubject?: boolean;
	requireObjectType?: boolean;
	clusters?: TCluster[];
	/** Predicates (priority order) whose target is the node's HypermediaRole. When set, each node's role is folded onto `properties[HYPERMEDIA_ROLE_KEY]` so a pure group-key selector can read it without re-walking edges. */
	roleRels?: readonly string[];
	/** The responding instance's site principal — the serving site of every node a cluster's `sites` doesn't override. When set, each node's serving site is folded onto `properties[SITE_KEY]`. */
	site?: string;
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
/** Whether a quad DRAWS as an edge, independent of which nodes are in hand. An edge is a TYPED reference: the quad
 *  carries `objectType` — the JSON-LD range of its target. A plain-string property (no objectType) is never an edge,
 *  even if its value coincidentally matches a node id. This is the same rule the overview's property classifier applies
 *  ("declared by the range, never guessed from the id"); guessing is what mis-linked string properties like `account`
 *  onto whatever node shared their value. THE rule, so a chip legend offers exactly the predicates the graph draws. */
export function isEdgeQuad(q: TQuad, opts: { requireObjectType?: boolean; ignoreInternalPredicates?: boolean } = { requireObjectType: true, ignoreInternalPredicates: true }): boolean {
	if (typeof q.subject !== "string" || typeof q.object !== "string") return false;
	if (q.subject === q.object) return false;
	if (opts.requireObjectType && (typeof q.objectType !== "string" || q.objectType.length === 0)) return false;
	if (opts.ignoreInternalPredicates && q.predicate.startsWith("_")) return false;
	return true;
}

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
		if (!isEdgeQuad(q, opts)) continue;
		if (!nodeMap.has(q.subject as string)) continue;
		if (opts.requireObjectSubject && !nodeMap.has(q.object as string)) continue;
		edges.push({ from: q.subject as string, to: q.object as string, predicate: q.predicate, graph: q.namedGraph });
	}

	if (options.clusters?.length) {
		// The cluster's server-computed displayLabels are the sole source of a node's title.
		for (const c of options.clusters) {
			for (const [subject, label] of Object.entries(c.displayLabels)) {
				const node = nodeMap.get(subject);
				if (!node) continue;
				// `label === subject` is composeDisplayLabel's id-fallback (the cluster @type has no NAME/CONTENT/body/weak rel — e.g. a name-less Principal sharing a named node's @id). Never let it clobber a real headline already set by another cluster for the same collapsed node. Order-independent: a real name beats the bare id regardless of cluster iteration order.
				if (label === subject && node.displayLabel !== undefined && node.displayLabel !== subject) continue;
				node.displayLabel = label;
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

	if (opts.site !== undefined) {
		// Fold each node's SERVING site (read-time store fact): a federated subject keeps the stamp its peer set
		// (cluster.sites), everything else was served by this response's own site. Overwrites a same-named literal
		// property, same as the role fold — the stamp is authoritative for the axis.
		const siteBySubject = new Map<string, string>();
		for (const c of options.clusters ?? []) if (c.sites) for (const [s, v] of Object.entries(c.sites)) siteBySubject.set(s, v);
		for (const node of nodeMap.values()) (node.properties ??= {})[SITE_KEY] = siteBySubject.get(node.id) ?? opts.site;
	}

	if (opts.roleRels?.length) {
		// Fold each node's HypermediaRole onto the node so the role grouping axis is a pure node read (single-source).
		// A node's role is the target of its highest-priority role edge; a node that IS a party — something is attributed
		// to it, i.e. it is a role-edge target — is its own role, so it lands in its own container, not "unattributed".
		const roleRelSet = new Set(opts.roleRels);
		const roleRank = new Map(opts.roleRels.map((r, i) => [r, i]));
		const outByFrom = new Map<string, GraphEdge[]>();
		const parties = new Set<string>();
		// A party's own role predicate: the highest-priority role rel by which anything attributes to it. Relational, so it
		// is read from the incoming role edges (a party is a role-edge target), not the party's `@type`.
		const partyRoleRel = new Map<string, string>();
		for (const e of edges) {
			const list = outByFrom.get(e.from);
			if (list) list.push(e);
			else outByFrom.set(e.from, [e]);
			if (roleRelSet.has(e.predicate)) {
				parties.add(e.to);
				const cur = partyRoleRel.get(e.to);
				if (cur === undefined || (roleRank.get(e.predicate) ?? Infinity) < (roleRank.get(cur) ?? Infinity)) partyRoleRel.set(e.to, e.predicate);
			}
		}
		for (const node of nodeMap.values()) {
			const out = outByFrom.get(node.id);
			// Record the agent at EACH actor predicate on the node, so a "group by <predicate>" axis reads a plain property
			// (properties[predicate]) with nothing enumerating the predicates — a rel declared subPropertyOf inRoleOf is
			// groupable the moment it appears.
			if (out) for (const e of out) if (roleRelSet.has(e.predicate)) (node.properties ??= {})[e.predicate] = e.to;
			// The "role" axis: the single highest-priority actor (ROLE_PRIORITY order, via opts.roleRels).
			let role: string | undefined;
			if (out)
				for (const rel of opts.roleRels) {
					const e = out.find((x) => x.predicate === rel);
					if (e) {
						role = e.to;
						break;
					}
				}
			if (role === undefined && parties.has(node.id)) role = node.id;
			if (role !== undefined) (node.properties ??= {})[HYPERMEDIA_ROLE_KEY] = role;
			const roleRel = partyRoleRel.get(node.id);
			if (roleRel !== undefined) (node.properties ??= {})[HYPERMEDIA_ROLE_REL_KEY] = roleRel;
		}
	}

	const dedup = new Map<string, GraphEdge>();
	for (const e of edges) dedup.set(`${e.graph}|${e.from}|${e.predicate}|${e.to}`, e);
	return { nodes: Array.from(nodeMap.values()), edges: Array.from(dedup.values()) };
}
