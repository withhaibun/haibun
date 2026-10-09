/**
 * Derives the filter clusters of every graph view that hosts a `<shu-graph-filter>`.
 *
 * The filter chips show one entry per node type with a count. The derivation has two cases:
 *
 *   - Without a time cursor: the server snapshot's `TCluster` records hold the counts. Each carries `totalCount`,
 *     `sampledCount` and `omittedCount`, so the legend can show `(sampled/total)` where the server truncated. A
 *     namedGraph that appears only in live (post-snapshot) quads gets a cluster with zero counts, so the legend
 *     matches what the diagram renders.
 *
 *   - With a time cursor pinned: the snapshot counts differ from what the view shows. The projection derives the
 *     clusters from `visibleQuads`, which `ShuElement.filterByTime` has filtered. It returns one cluster per
 *     `namedGraph` and counts the unique subjects seen at or before the cursor. A type without visible subjects at
 *     the cursor drops from the legend. `Kihan (7)` becomes `Kihan (3)` at one point in the timeline and leaves the
 *     legend before the first Kihan node arrives.
 *
 * Each host (graph-view and external viewers) holds its own `knownClusters` map and quads, and passes them to
 * `filterEl.setSource(...)`. The filter's render calls this pure function with them.
 */
import type { TCluster, TQuad } from "@haibun/core/lib/quad-types.js";
import { isInstrumentationType } from "./rels-cache.js";
import { isSchemaType } from "./graph/ontology-projection.js";
import { isEdgeQuad } from "./graph-model.js";

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
		// Copies the source cluster's labels for the subjects still visible.
		const sourceLabels = opts.knownClusters.get(type)?.displayLabels ?? {};
		const displayLabels: Record<string, string> = {};
		for (const s of sampledSubjects) if (sourceLabels[s] !== undefined) displayLabels[s] = sourceLabels[s];
		clusters.push({ type, totalCount: sampledSubjects.length, sampledCount: sampledSubjects.length, omittedCount: 0, sampledSubjects, displayLabels });
	}
	return clusters;
}

/**
 * Returns the effective hidden-type set. A person's explicit override takes precedence. Without an override,
 * instrumentation and the schema types (`isSchemaType`) are hidden by default, and every other type is visible.
 * Instrumentation is a type whose declaration states it (`isInstrumentationType`), as the facts and the variables do.
 * `overrides[type]`: true = shown, false = hidden, absent = the predicate determines it. This function is the one place
 * that combines the default with the overrides. The filter (chip state) and the host views (which graphs render) call it,
 * so a live page and an offline report hide the same types. The rule applies the same way to a type that arrives only
 * through the live stream. It doesn't keep a per-cluster flag, and reads a predicate over the type name instead. The
 * persisted overrides hold only a person's explicit choices and never a fixed default. A change to what counts as
 * instrumentation therefore applies on the next load.
 *
 * A domain type isn't hidden by default because its title is hard to compute. A type names the property or edge that
 * titles it (`topology.displayLabel`), so it draws with a title instead of its id.
 */
export function effectiveHiddenTypes(types: Iterable<string>, overrides: Record<string, boolean>): string[] {
	const hidden = new Set<string>();
	for (const type of types) {
		const choice = overrides[type];
		if (choice === undefined ? isInstrumentationType(type) || isSchemaType(type) : !choice) hidden.add(type);
	}
	// An explicit hide applies before its type appears in `types`, such as a control-product hide of a type without data.
	// An explicit show of an absent type doesn't change the view until the type arrives. The type shows then.
	for (const type of explicitlyHidden(overrides)) hidden.add(type);
	return [...hidden];
}

/** Returns the edge predicates in `quads` in predicate order, with the number of edges each draws. The count applies
 *  the graph model's own edge rule (`isEdgeQuad`), so the property chips offer the predicates the graph draws. A chip
 *  doesn't offer a predicate whose unticking wouldn't change the graph. */
export function derivePredicates(quads: Iterable<TQuad>): Array<{ predicate: string; count: number }> {
	const counts = new Map<string, number>();
	for (const q of quads) {
		if (!isEdgeQuad(q)) continue;
		counts.set(q.predicate, (counts.get(q.predicate) ?? 0) + 1);
	}
	return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([predicate, count]) => ({ predicate, count }));
}

/** Returns the facets a reader turned off. An override of false marks a facet as turned off. This function is the
 *  counterpart of `effectiveHiddenTypes` for facets without a declared default: a predicate shows unless a reader
 *  unticked it. */
export function explicitlyHidden(overrides: Record<string, boolean>): string[] {
	return Object.entries(overrides)
		.filter(([, shown]) => !shown)
		.map(([facet]) => facet);
}
