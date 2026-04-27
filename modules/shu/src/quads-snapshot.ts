import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { SseClient, inAction } from "./sse-client.js";
import { getAvailableSteps } from "./rpc-registry.js";

export const DEFAULT_PER_TYPE_LIMIT = 100;

export type TGraphSnapshot = { quads: TQuad[]; clusters: TCluster[] };

type CacheEntry = { snapshot: TGraphSnapshot; perTypeLimit: number; typesKey: string };
let cache: CacheEntry | null = null;
let pending: Promise<TGraphSnapshot> | null = null;

function typesKey(types?: string[]): string {
	return types?.length ? [...types].sort().join(",") : "*";
}

/**
 * Fetch a type-bounded graph snapshot. Returns sampled quads + cluster
 * summaries with omitted counts so the view can render an "+N more" cluster
 * node per type. The snapshot is cached per (perTypeLimit, types) tuple;
 * passing different opts triggers a fresh fetch.
 */
export async function getGraphSnapshot(opts: { perTypeLimit?: number; types?: string[]; forceRefresh?: boolean } = {}): Promise<TGraphSnapshot> {
	const perTypeLimit = opts.perTypeLimit ?? DEFAULT_PER_TYPE_LIMIT;
	const tk = typesKey(opts.types);
	if (opts.forceRefresh || !cache || cache.perTypeLimit !== perTypeLimit || cache.typesKey !== tk) {
		cache = null;
		pending = null;
	}
	if (cache) return cache.snapshot;
	if (pending) return pending;
	pending = (async () => {
		const steps = await getAvailableSteps();
		if (!steps?.length) throw new Error("getAvailableSteps() returned empty — step registry not yet populated");
		const client = SseClient.for("");
		const data = await inAction((scope) =>
			client.rpc<{ quads: TQuad[]; clusters: TCluster[] }>(scope, "MonitorStepper-getClusteredQuads", { perTypeLimit, types: opts.types }),
		);
		if (!Array.isArray(data.quads)) throw new Error("MonitorStepper-getClusteredQuads returned non-array quads");
		const snapshot = { quads: data.quads, clusters: data.clusters ?? [] };
		cache = { snapshot, perTypeLimit, typesKey: tk };
		return snapshot;
	})();
	try {
		return await pending;
	} finally {
		pending = null;
	}
}

/**
 * Merge newly observed quads into the shared snapshot cache. Updates each
 * affected cluster: a new subject promotes from omitted to sampled (caps at
 * the requested limit; further omitted subjects bump `totalCount`).
 */
export function mergeQuadsIntoSnapshot(quads: TQuad[]): void {
	if (quads.length === 0 || !cache) return;
	const snap = cache.snapshot;
	const clusterByType = new Map<string, TCluster>();
	const sampledByType = new Map<string, Set<string>>();
	for (const c of snap.clusters) {
		clusterByType.set(c.type, c);
		sampledByType.set(c.type, new Set(c.sampledSubjects));
	}
	for (const q of quads) {
		snap.quads.push(q);
		let cluster = clusterByType.get(q.namedGraph);
		if (!cluster) {
			cluster = { type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [] };
			snap.clusters.push(cluster);
			clusterByType.set(q.namedGraph, cluster);
			sampledByType.set(q.namedGraph, new Set());
		}
		const sampled = sampledByType.get(q.namedGraph) ?? new Set<string>();
		if (sampled.has(q.subject)) continue;
		sampled.add(q.subject);
		cluster.sampledSubjects.push(q.subject);
		cluster.sampledCount = sampled.size;
		cluster.totalCount = Math.max(cluster.totalCount + 1, cluster.sampledCount);
		cluster.omittedCount = Math.max(0, cluster.totalCount - cluster.sampledCount);
	}
}
