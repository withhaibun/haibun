/**
 * graph-filter-projection — shared cluster derivation used by every graph
 * view that hosts a `<shu-graph-filter>`.
 *
 * The filter chips show one entry per node type with a count. Two regimes
 * matter:
 *
 *   - No time cursor — the server snapshot's `TCluster` records are
 *     authoritative: each carries `totalCount`, `sampledCount`, and
 *     `omittedCount` so the legend can show `(sampled/total)` when the server
 *     truncated. Any namedGraph that appears only in live (post-snapshot)
 *     quads is appended with zero counts so the legend matches what the
 *     diagram actually renders.
 *
 *   - Time cursor pinned — the snapshot counts diverge from what the view
 *     shows. Derive clusters directly from `visibleQuads` (already filtered
 *     by `ShuElement.filterByTime`): one cluster per `namedGraph`, count =
 *     unique subjects seen at or before the cursor. Types with no visible
 *     subjects at T drop from the legend, so `Kihan (7)` becomes `Kihan (3)`
 *     at one point in the timeline and disappears entirely before the first
 *     Kihan node arrives.
 *
 * Hosts (graph-view and external viewers) keep their own `knownClusters` map and quads;
 * this projection is a pure function so each view's render can call it and
 * hand the result straight to `filterEl.setClusters(...)`.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { isInstrumentationGraph } from "@haibun/core/lib/instrumentation-graphs.js";
import { isSchemaType } from "./graph/ontology-projection.js";

export function projectFilterClusters(opts: { knownClusters: Map<string, TCluster>; allQuads: TQuad[]; visibleQuads: TQuad[]; timeCursor: number | null }): TCluster[] {
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
			merged.push({ type: q.namedGraph, totalCount: 0, sampledCount: 0, omittedCount: 0, sampledSubjects: [], displayLabels: {} });
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
		// Carry over the source cluster's labels for the still-visible subjects.
		const sourceLabels = opts.knownClusters.get(type)?.displayLabels ?? {};
		const displayLabels: Record<string, string> = {};
		for (const s of sampledSubjects) if (sourceLabels[s] !== undefined) displayLabels[s] = sourceLabels[s];
		clusters.push({ type, totalCount: sampledSubjects.length, sampledCount: sampledSubjects.length, omittedCount: 0, sampledSubjects, displayLabels });
	}
	return clusters;
}

/**
 * The effective hidden-type set: the user's explicit override wins; absent an override, the engine's own instrumentation
 * graphs (SeqPath, observation/*, facts, variables — `isInstrumentationGraph`) default hidden and everything else visible.
 * `overrides[type]`: true = shown, false = hidden, absent = the predicate decides. The ONE place the default and the
 * overrides combine — shared by the filter (chip state), the host views (which graphs render), and the offline-report
 * serialization — so the rule is identical everywhere AND robust to types that arrive only via the live stream: there is
 * no per-cluster flag to lose, just the stable predicate over the type name. The persisted overrides hold only the user's
 * deliberate choices, never a fixed default, so a change to what counts as instrumentation re-applies on the next load.
 */
export function effectiveHiddenTypes(types: Iterable<string>, overrides: Record<string, boolean>): string[] {
	const hidden = new Set<string>();
	for (const type of types) {
		const choice = overrides[type];
		if (choice === undefined ? isInstrumentationGraph(type) || isSchemaType(type) : !choice) hidden.add(type);
	}
	// An explicit hide applies even before its type appears in the set (e.g. a control-product hide of a type with no
	// data yet); an explicit show of an unknown type is a no-op until it arrives (it then follows the show).
	for (const [type, choice] of Object.entries(overrides)) if (choice === false) hidden.add(type);
	return [...hidden];
}
