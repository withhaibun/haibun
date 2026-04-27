import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { resolveDisplayLabel } from "@haibun/core/lib/hypermedia.js";
import { getRels } from "./rels-cache.js";

export type GraphNode = { id: string; type: string; isCluster?: boolean; omittedCount?: number; displayLabel?: string };
export type GraphEdge = { from: string; to: string; predicate: string; graph: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * Client-side fallback display label, used when the server didn't ship a
 * pre-computed value (e.g. the rels-cache is unpopulated in a bundle that
 * hasn't fetched the concern catalog yet). Walks the same rel priority as the
 * server via the shared `resolveDisplayLabel`.
 */
export function displayLabelForVertex(label: string, subject: string, propertyQuads: TQuad[]): string {
	const resolved = resolveDisplayLabel(getRels(label), (field) => {
		const q = propertyQuads.find((p) => p.predicate === field && (typeof p.object === "string" || typeof p.object === "number"));
		return q?.object;
	});
	return resolved ?? subject;
}

type BuildGraphModelOptions = {
	ignoreInternalPredicates?: boolean;
	requireObjectSubject?: boolean;
	clusters?: TCluster[];
};

const DEFAULT_OPTIONS: Required<Pick<BuildGraphModelOptions, "ignoreInternalPredicates" | "requireObjectSubject">> = {
	ignoreInternalPredicates: true,
	requireObjectSubject: true,
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
	const quadsBySubject = new Map<string, TQuad[]>();
	for (const q of quads) {
		if (typeof q.subject !== "string" || q.subject.length === 0) continue;
		let bucket = quadsBySubject.get(q.subject);
		if (!bucket) {
			bucket = [];
			quadsBySubject.set(q.subject, bucket);
		}
		bucket.push(q);
		if (!nodeMap.has(q.subject)) nodeMap.set(q.subject, { id: q.subject, type: q.namedGraph });
	}
	for (const node of nodeMap.values()) {
		node.displayLabel = displayLabelForVertex(node.type, node.id, quadsBySubject.get(node.id) ?? []);
	}

	const edges: GraphEdge[] = [];
	for (const q of quads) {
		if (typeof q.subject !== "string" || typeof q.object !== "string") continue;
		if (q.subject === q.object) continue;
		if (opts.ignoreInternalPredicates && q.predicate.startsWith("_")) continue;
		if (!nodeMap.has(q.subject)) continue;
		if (opts.requireObjectSubject && !nodeMap.has(q.object)) continue;
		edges.push({ from: q.subject, to: q.object, predicate: q.predicate, graph: q.namedGraph });
	}

	if (options.clusters?.length) {
		// Apply server-side displayLabels to sampled nodes first — these take precedence over the rels-cache fallback computed above (which is empty in bundles that haven't loaded the concern catalog).
		for (const c of options.clusters) {
			if (!c.displayLabels) continue;
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

	const dedup = new Map<string, GraphEdge>();
	for (const e of edges) dedup.set(`${e.graph}|${e.from}|${e.predicate}|${e.to}`, e);
	return { nodes: Array.from(nodeMap.values()), edges: Array.from(dedup.values()) };
}
