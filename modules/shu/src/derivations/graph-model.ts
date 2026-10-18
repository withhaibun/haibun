import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { statedTotal, type TCounted } from "@haibun/core/lib/hypermedia.js";
import { LinkRelations } from "@haibun/core/lib/resources.js";
import { HYPERMEDIA_ROLE_KEY, HYPERMEDIA_ROLE_REL_KEY, SITE_KEY, type GraphEdge, type GraphModel, type GraphNode, type TBuildGraphModelOptions } from "../domains/graph-model.js";

/** Returns the records of a type that a sample leaves out, as a node names them: "+N more", or "+N or more" where the type's
 *  count stopped at its ceiling. */
export const omittedLabel = (omitted: TCounted): string => (omitted.saturated ? `+${statedTotal(omitted)}` : `+${omitted.total} more`);

/** Returns the count of the records of a cluster that a sample leaves out. A count that stopped at its ceiling is a floor. */
export const omittedOf = (cluster: TCluster): TCounted => ({ total: cluster.omittedCount, saturated: cluster.saturated === true });

const CLUSTER_PREDICATE = "clusterOf";

/** The id of the node of a type's omitted records: those under one record, or the rest. */
const clusterId = (type: string, under?: string): string => (under === undefined ? `cluster:${type}` : `cluster:${type}:${under}`);

/** Returns whether a quad draws as an edge, independent of which nodes the model holds. An edge is a typed reference.
 *  The quad carries `objectType`, which is the JSON-LD range of its target. A plain-string property without an
 *  `objectType` is never an edge, even where its value matches a node id. The overview's property classifier applies
 *  the same rule ("declared by the range, never guessed from the id"). Guessing from the id would link a string property
 *  such as `account` to any node that shares its value. A quad whose subject is its object doesn't draw as an edge.
 *  A predicate that starts with `_` doesn't draw as an edge either. The chip legend reads this rule, so it offers the
 *  predicates the graph draws. */
export function isEdgeQuad(q: TQuad): boolean {
	if (typeof q.subject !== "string" || typeof q.object !== "string") return false;
	if (q.subject === q.object) return false;
	if (typeof q.objectType !== "string" || q.objectType.length === 0) return false;
	return !q.predicate.startsWith("_");
}

/**
 * Builds a normalized graph model from quads. Where `clusters` are given, the model holds a node for the records a
 * cluster omits under each record it holds, linked to that record as its part, and a node for the rest of the records it
 * omits, which a `clusterOf` edge connects to each sampled subject that isn't part of another the model holds, so force
 * layout places it inside its type's neighbourhood.
 */
export function buildGraphModelFromQuads(quads: TQuad[], options?: TBuildGraphModelOptions): GraphModel {
	const nodeMap = new Map<string, GraphNode>();
	for (const q of quads) {
		if (typeof q.subject !== "string" || q.subject.length === 0) continue;
		let node = nodeMap.get(q.subject);
		if (!node) {
			node = { id: q.subject, type: q.namedGraph, properties: {} };
			nodeMap.set(q.subject, node);
		}
		// Copies the node's literal properties onto the node, so paints read per-node data (image, dates, coordinates, …)
		// that the renderer-agnostic edge model would otherwise drop. A literal property has a value and isn't a typed edge
		// (objectType set), an internal `_` key or a JSON-LD `@` key. The last value of a repeated predicate replaces the
		// earlier ones.
		if (q.objectType === undefined && typeof q.object !== "object" && q.object != null && !q.predicate.startsWith("_") && !q.predicate.startsWith("@")) {
			node.properties[q.predicate] = q.object;
		}
	}

	const edges: GraphEdge[] = [];
	for (const q of quads) {
		// An edge connects two nodes the model holds.
		if (!isEdgeQuad(q) || !nodeMap.has(q.subject as string) || !nodeMap.has(q.object as string)) continue;
		edges.push({ from: q.subject as string, to: q.object as string, predicate: q.predicate, graph: q.namedGraph });
	}

	if (options?.clusters !== undefined) {
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
		const parts = new Set(edges.filter((e) => e.predicate === LinkRelations.PART_OF.rel).map((e) => e.from));
		for (const c of options.clusters) {
			let rest = c.omittedCount;
			for (const [under, total] of c.omittedUnder === undefined ? [] : Object.entries(c.omittedUnder)) {
				if (!nodeMap.has(under)) continue;
				const cid = clusterId(c.type, under);
				nodeMap.set(cid, { id: cid, type: c.type, isCluster: true, omitted: { total, saturated: false }, properties: {} });
				edges.push({ from: cid, to: under, predicate: LinkRelations.PART_OF.rel, graph: c.type });
				rest -= total;
			}
			if (rest <= 0) continue;
			const cid = clusterId(c.type);
			nodeMap.set(cid, { id: cid, type: c.type, isCluster: true, omitted: { ...omittedOf(c), total: rest }, properties: {} });
			for (const sampledSubject of c.sampledSubjects) {
				if (!nodeMap.has(sampledSubject) || parts.has(sampledSubject)) continue;
				edges.push({ from: cid, to: sampledSubject, predicate: CLUSTER_PREDICATE, graph: c.type });
			}
		}
	}

	const site = options?.site;
	if (site !== undefined) {
		// Merges each node's serving site onto the node. The serving site is a read-time store fact. A federated subject
		// keeps the stamp its peer set (`cluster.sites`). This response's own site served every other node. The stamp
		// replaces a literal property of the same name, as the role merge does, because the stamp determines the site axis.
		const siteBySubject = new Map<string, string>();
		if (options?.clusters !== undefined) for (const c of options.clusters) if (c.sites) for (const [s, v] of Object.entries(c.sites)) siteBySubject.set(s, v);
		for (const node of nodeMap.values()) node.properties[SITE_KEY] = siteBySubject.get(node.id) ?? site;
	}

	const roleRels = options?.roleRels;
	if (roleRels !== undefined && roleRels.length > 0) {
		// Merges each node's HypermediaRole onto the node, so the role grouping axis reads only the node. A node's role is
		// the target of its highest-priority role edge. A party is a node that a role edge targets. A party without a role
		// edge of its own is its own role, so it groups in its own container instead of "unattributed".
		const roleRelSet = new Set(roleRels);
		const roleRank = new Map(roleRels.map((r, i) => [r, i]));
		const rankOf = (rel: string): number => {
			const rank = roleRank.get(rel);
			if (rank === undefined) throw new Error(`${rel} isn't one of the role relations the build ranks`);
			return rank;
		};
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
				if (cur === undefined || rankOf(e.predicate) < rankOf(cur)) partyRoleRel.set(e.to, e.predicate);
			}
		}
		for (const node of nodeMap.values()) {
			const out = outByFrom.get(node.id);
			// Records the agent of each actor predicate on the node as `properties[predicate]`. A "group by <predicate>" axis
			// reads that plain property, so code doesn't enumerate the predicates. A rel declared subPropertyOf inRoleOf can
			// group as soon as it appears.
			if (out) for (const e of out) if (roleRelSet.has(e.predicate)) node.properties[e.predicate] = e.to;
			// The "role" axis reads the highest-priority actor, in ROLE_PRIORITY order through `roleRels`.
			let role: string | undefined;
			if (out)
				for (const rel of roleRels) {
					const e = out.find((x) => x.predicate === rel);
					if (e) {
						role = e.to;
						break;
					}
				}
			if (role === undefined && parties.has(node.id)) role = node.id;
			if (role !== undefined) node.properties[HYPERMEDIA_ROLE_KEY] = role;
			const roleRel = partyRoleRel.get(node.id);
			if (roleRel !== undefined) node.properties[HYPERMEDIA_ROLE_REL_KEY] = roleRel;
		}
	}

	const dedup = new Map<string, GraphEdge>();
	for (const e of edges) dedup.set(`${e.graph}|${e.from}|${e.predicate}|${e.to}`, e);
	return { nodes: Array.from(nodeMap.values()), edges: Array.from(dedup.values()) };
}
