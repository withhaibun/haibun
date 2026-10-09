import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { statedTotal, type TCounted } from "@haibun/core/lib/hypermedia.js";

type GraphNode = { id: string; type: string; isCluster?: boolean; omitted?: TCounted; displayLabel?: string; properties?: Record<string, unknown> };

/** Returns the records of a type that a sample leaves out, as a node names them: "+N more", or "+N or more" where the type's
 *  count stopped at its ceiling. */
export const omittedLabel = (omitted: TCounted): string => (omitted.saturated ? `+${statedTotal(omitted)}` : `+${omitted.total} more`);

/** Returns the count of the records of a cluster that a sample leaves out. A count that stopped at its ceiling is a floor. */
export const omittedOf = (cluster: TCluster): TCounted => ({ total: cluster.omittedCount, saturated: cluster.saturated === true });
type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Names the node property that holds the resolved HypermediaRole. The value is the id of the party (a `prov:Agent`/Principal) to which the node is attributed. `buildGraphModelFromQuads` reduces it from the node's role edges (see `roleRels`). The polymorphic view's role grouping axis reads it. */
export const HYPERMEDIA_ROLE_KEY = "hypermediaRole";

/** Names the node property that holds a party's own role predicate. The value is the highest-priority role rel (a `fromActor`/`toActor`, see `roleRels`) among the role edges that target the party. A party is one node. Its role is relational because the party is the target of a role edge, so the value comes from the incoming role edges and not from the node's `@type`. A display site maps this predicate to the party's role designation. */
export const HYPERMEDIA_ROLE_REL_KEY = "hypermediaRoleRel";

/** Names the node property that holds the site principal of the instance whose store served the node. The value is a read-time store fact stamped at the federation merge and is never persisted. HAIBUN_SITE_KEY is a different key: it holds the env override for this instance's own principal. The polymorphic view's site grouping axis reads this property. */
export const SITE_KEY = "site";

type BuildGraphModelOptions = {
	ignoreInternalPredicates?: boolean;
	requireObjectSubject?: boolean;
	requireObjectType?: boolean;
	clusters?: TCluster[];
	/** Lists the predicates, in priority order, whose target is the node's HypermediaRole. The build merges each node's role onto `properties[HYPERMEDIA_ROLE_KEY]` where this is set, so a pure group-key selector reads the role without walking the edges again. */
	roleRels?: readonly string[];
	/** Names the responding instance's site principal. It is the serving site of every node that a cluster's `sites` doesn't override. The build merges each node's serving site onto `properties[SITE_KEY]` where this is set. */
	site?: string;
};

const DEFAULT_OPTIONS: Required<Pick<BuildGraphModelOptions, "ignoreInternalPredicates" | "requireObjectSubject" | "requireObjectType">> = {
	ignoreInternalPredicates: true,
	requireObjectSubject: true,
	requireObjectType: true,
};

const CLUSTER_PREDICATE = "clusterOf";

function clusterId(type: string): string {
	return `cluster:${type}`;
}

/** Returns whether a quad draws as an edge, independent of which nodes the model holds. An edge is a typed reference.
 *  The quad carries `objectType`, which is the JSON-LD range of its target. A plain-string property without an
 *  `objectType` is never an edge, even where its value matches a node id. The overview's property classifier applies
 *  the same rule ("declared by the range, never guessed from the id"). Guessing from the id would link a string property
 *  such as `account` to any node that shares its value. A quad whose subject is its object doesn't draw as an edge.
 *  With the default options, a predicate that starts with `_` doesn't draw as an edge either. The chip legend reads this
 *  rule, so it offers the predicates the graph draws. */
export function isEdgeQuad(
	q: TQuad,
	opts: { requireObjectType?: boolean; ignoreInternalPredicates?: boolean } = { requireObjectType: true, ignoreInternalPredicates: true },
): boolean {
	if (typeof q.subject !== "string" || typeof q.object !== "string") return false;
	if (q.subject === q.object) return false;
	if (opts.requireObjectType && (typeof q.objectType !== "string" || q.objectType.length === 0)) return false;
	if (opts.ignoreInternalPredicates && q.predicate.startsWith("_")) return false;
	return true;
}

/**
 * Builds a normalized graph model from quads. Where `clusters` are given, the model holds a cluster node for each type
 * with `omittedCount > 0`. A `clusterOf` edge connects the cluster node to each sampled subject the model holds, so force
 * layout places the cluster inside its type's neighbourhood.
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
		// Copies the node's literal properties onto the node, so paints read per-node data (image, dates, coordinates, …)
		// that the renderer-agnostic edge model would otherwise drop. A literal property has a value and isn't a typed edge
		// (objectType set), an internal `_` key or a JSON-LD `@` key. The last value of a repeated predicate replaces the
		// earlier ones.
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
				// `label === subject` is composeDisplayLabel's id fallback. composeDisplayLabel falls back to the id where the cluster's @type doesn't have a NAME/CONTENT/body/weak rel, such as a Principal without a name that shares a named node's @id. The id fallback doesn't replace a title another cluster set for the same collapsed node. A name takes precedence over the bare id in any cluster order.
				if (label === subject && node.displayLabel !== undefined && node.displayLabel !== subject) continue;
				node.displayLabel = label;
			}
		}
		for (const c of options.clusters) {
			if (c.omittedCount <= 0) continue;
			const cid = clusterId(c.type);
			nodeMap.set(cid, { id: cid, type: c.type, isCluster: true, omitted: omittedOf(c) });
			for (const sampledSubject of c.sampledSubjects) {
				if (!nodeMap.has(sampledSubject)) continue;
				edges.push({ from: cid, to: sampledSubject, predicate: CLUSTER_PREDICATE, graph: c.type });
			}
		}
	}

	if (opts.site !== undefined) {
		// Merges each node's serving site onto the node. The serving site is a read-time store fact. A federated subject
		// keeps the stamp its peer set (`cluster.sites`). This response's own site served every other node. The stamp
		// replaces a literal property of the same name, as the role merge does, because the stamp determines the site axis.
		const siteBySubject = new Map<string, string>();
		for (const c of options.clusters ?? []) if (c.sites) for (const [s, v] of Object.entries(c.sites)) siteBySubject.set(s, v);
		for (const node of nodeMap.values()) (node.properties ??= {})[SITE_KEY] = siteBySubject.get(node.id) ?? opts.site;
	}

	if (opts.roleRels?.length) {
		// Merges each node's HypermediaRole onto the node, so the role grouping axis reads only the node. A node's role is
		// the target of its highest-priority role edge. A party is a node that a role edge targets. A party without a role
		// edge of its own is its own role, so it groups in its own container instead of "unattributed".
		const roleRelSet = new Set(opts.roleRels);
		const roleRank = new Map(opts.roleRels.map((r, i) => [r, i]));
		const outByFrom = new Map<string, GraphEdge[]>();
		const parties = new Set<string>();
		// Holds each party's own role predicate, which is the highest-priority role rel among the role edges that target
		// it. The role is relational, so it comes from the incoming role edges and not from the party's `@type`.
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
			// Records the agent of each actor predicate on the node as `properties[predicate]`. A "group by <predicate>" axis
			// reads that plain property, so code doesn't enumerate the predicates. A rel declared subPropertyOf inRoleOf can
			// group as soon as it appears.
			if (out) for (const e of out) if (roleRelSet.has(e.predicate)) (node.properties ??= {})[e.predicate] = e.to;
			// The "role" axis reads the highest-priority actor, in ROLE_PRIORITY order through `opts.roleRels`.
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
