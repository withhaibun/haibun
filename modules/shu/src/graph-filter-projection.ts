/**
 * graph-filter-projection — shared cluster derivation used by every graph
 * view that hosts a `<shu-graph-filter>`.
 *
 * The filter chips show one entry per vertex type with a count. Two regimes
 * matter:
 *
 *   - No time cursor — the server snapshot's `TCluster` records are
 *     authoritative: each carries `totalCount`, `sampledCount`, and
 *     `omittedCount` so the legend can show `(sampled/total)` when the server
 *     truncated. Any namedGraph that appears only in live (post-snapshot)
 *     quads is appended with zero counts so the legend matches what the
 *     diagram actually renders.
 *
 *   - Time cursor pinned — the snapshot counts no longer match what the view
 *     shows. Derive clusters directly from `visibleQuads` (already filtered
 *     by `ShuElement.filterByTime`): one cluster per `namedGraph`, count =
 *     unique subjects seen at or before the cursor. Types with no visible
 *     subjects at T drop from the legend, so `Kihan (7)` becomes `Kihan (3)`
 *     at one point in the timeline and disappears entirely before the first
 *     Kihan vertex arrives.
 *
 * Hosts (graph-view, fisheye) keep their own `knownClusters` map and quads;
 * this projection is a pure function so each view's render can call it and
 * hand the result straight to `filterEl.setClusters(...)`.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";

export function projectFilterClusters(opts: {
	knownClusters: Map<string, TCluster>;
	allQuads: TQuad[];
	visibleQuads: TQuad[];
	timeCursor: number | null;
}): TCluster[] {
	if (opts.timeCursor === null) {
		const seen = new Set<string>();
		const merged: TCluster[] = [];
		for (const c of opts.knownClusters.values()) {
			merged.push(c);
			seen.add(c.type);
		}
		for (const q of opts.allQuads) {
			if (seen.has(q.namedGraph)) continue;
			seen.add(q.namedGraph);
			merged.push({ type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [] });
		}
		return merged;
	}
	const subjectsByType = new Map<string, Set<string>>();
	for (const q of opts.visibleQuads) {
		let subs = subjectsByType.get(q.namedGraph);
		if (!subs) {
			subs = new Set();
			subjectsByType.set(q.namedGraph, subs);
		}
		subs.add(q.subject);
	}
	const clusters: TCluster[] = [];
	for (const [type, subs] of subjectsByType) {
		const sampledSubjects = [...subs];
		clusters.push({ type, totalCount: sampledSubjects.length, sampledCount: sampledSubjects.length, omittedCount: 0, sampledSubjects });
	}
	return clusters;
}
