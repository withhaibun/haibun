/**
 * A sample of a store's quads by type, and the division of a span of time into a fixed count of buckets. A store that
 * holds its quads in memory samples and counts them through these derivations.
 */
import { displayLabelForQuads, type TTitledBy } from "../../hypermedia.js";
import { BODY_LABEL, LinkRelations } from "../../resources.js";
import type { TCluster, TClusteredQuads, TQuad } from "../domains/quad-types.js";

/** The property or edge that titles a type's records, where the type declares one. */
export type TTitledByOf = (type: string) => TTitledBy | undefined;

/**
 * Which bucket an instant falls in, over a span divided into a fixed number, or -1 outside the span.
 *
 * The division is by the span rather than by a rounded width, so a span that doesn't divide evenly still returns exactly
 * the buckets a read states. The last bucket includes the end, since a bucket after it doesn't exist to hold it.
 */
export function bucketOf(at: number, from: number, to: number, buckets: number): number {
	if (at < from || at > to) return -1;
	if (to === from) return 0;
	return Math.min(buckets - 1, Math.floor(((at - from) / (to - from)) * buckets));
}

/** Returns the set `map` holds under `key`, making the set where the map lacks it. */
function heldSet<T>(map: Map<string, Set<T>>, key: string): Set<T> {
	const held = map.get(key);
	if (held !== undefined) return held;
	const made = new Set<T>();
	map.set(key, made);
	return made;
}

/** Returns the list `map` holds under `key`, making the list where the map lacks it. */
function heldList<T>(map: Map<string, T[]>, key: string): T[] {
	const held = map.get(key);
	if (held !== undefined) return held;
	const made: T[] = [];
	map.set(key, made);
	return made;
}

/**
 * Groups quads by named graph, keeps up to `perTypeLimit` distinct subjects of each group, and summarizes each group as a
 * TCluster. `sampledElsewhere` holds the quads another store already sampled, so a merged count holds each subject once.
 * Each record this sample holds is labelled the way every producer labels it: its declared title, the shortest linked
 * body's text, or its id.
 */
export function sliceQuadsPerType(quads: readonly TQuad[], perTypeLimit: number, sampledElsewhere: readonly TQuad[], titledBy: TTitledByOf): TClusteredQuads {
	const sampledByType = new Map<string, Set<string>>();
	for (const q of sampledElsewhere) heldSet(sampledByType, q.namedGraph).add(q.subject);
	const subjectsByType = new Map<string, Set<string>>();
	const quadsByType = new Map<string, TQuad[]>();
	const quadsBySubject = new Map<string, TQuad[]>();
	const bodyContentBySubject = new Map<string, string>();
	for (const q of quads) {
		heldSet(subjectsByType, q.namedGraph).add(q.subject);
		heldList(quadsByType, q.namedGraph).push(q);
		heldList(quadsBySubject, q.subject).push(q);
		if (q.namedGraph === BODY_LABEL && q.predicate === LinkRelations.CONTENT.rel && typeof q.object === "string") bodyContentBySubject.set(q.subject, q.object);
	}
	const sampledQuads: TQuad[] = [];
	const clusters: TCluster[] = [];
	for (const [type, subjectSet] of subjectsByType) {
		const alreadySampled = heldSet(sampledByType, type);
		const newSubjects = [...subjectSet].filter((s) => !alreadySampled.has(s));
		const keep = new Set([...alreadySampled, ...newSubjects.slice(0, Math.max(0, perTypeLimit - alreadySampled.size))]);
		for (const q of heldList(quadsByType, type)) if (keep.has(q.subject)) sampledQuads.push(q);
		// A subject another store sampled labels itself, so this sample labels only the subjects it holds.
		const displayLabels: Record<string, string> = {};
		for (const subject of keep) {
			const held = quadsBySubject.get(subject);
			if (held !== undefined) displayLabels[subject] = displayLabelForQuads(type, subject, held, (b) => bodyContentBySubject.get(b), undefined, titledBy(type));
		}
		const total = alreadySampled.size + subjectSet.size;
		clusters.push({ type, totalCount: total, sampledCount: keep.size, omittedCount: Math.max(0, total - keep.size), sampledSubjects: [...keep], displayLabels });
	}
	return { quads: sampledQuads, clusters };
}
