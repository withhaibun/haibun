/**
 * A sample of a store's quads by type, and the division of a span of time into a fixed count of buckets. A store that
 * holds its quads in memory samples and counts them through these derivations.
 */
import { displayLabelForQuads } from "../../hypermedia.js";
import type { TReadDeclaration } from "../../records/derivations/read-records.js";
import { BODY_LABEL, LinkRelations } from "../../resources.js";
import type { TCluster, TClusteredQuads, TQuad } from "../domains/quad-types.js";

/** What a sample reads of a type's declaration, where the type declares one: the property or edge that titles its records,
 *  and the field that orders its records. */
export type TSampledDeclarationOf = (type: string) => Pick<TReadDeclaration, "title" | "defaultSort"> | undefined;

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
 * Orders a type's subjects for a sample: each subject after the subject it is part of, where both are of the type, and
 * subjects of one depth with parts of their own before those without, then by the type's declared sort, then as the
 * store holds them. A subject that is part of one the store doesn't hold comes after every subject of the held hierarchy. A sample within a limit then holds a type's top
 * records and their nearest parts, and the records it leaves out hang from the records it holds.
 */
function sampleOrder(subjects: readonly string[], parentOf: ReadonlyMap<string, string>, sortValueOf: (subject: string) => string | undefined): string[] {
	const held = new Set(subjects);
	const depthOf = (subject: string): number => {
		const seen = new Set([subject]);
		let parent = parentOf.get(subject);
		while (parent !== undefined && !seen.has(parent)) {
			if (!held.has(parent)) return Number.POSITIVE_INFINITY;
			seen.add(parent);
			parent = parentOf.get(parent);
		}
		return seen.size;
	};
	const parents = new Set(parentOf.values());
	const keyed = subjects.map((subject, at) => ({ subject, at, depth: depthOf(subject), leaf: parents.has(subject) ? 0 : 1, sort: sortValueOf(subject) }));
	// A record without the sort field comes after the records that state it.
	const bySort = (a?: string, b?: string): number => (a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1);
	return keyed.sort((a, b) => (a.depth === b.depth ? 0 : a.depth - b.depth) || a.leaf - b.leaf || bySort(a.sort, b.sort) || a.at - b.at).map(({ subject }) => subject);
}

/**
 * Groups quads by named graph, keeps up to `perTypeLimit` distinct subjects of each group in `sampleOrder`, and summarizes
 * each group as a TCluster, with the count of the records it leaves out under each held record that contains them.
 * `sampledElsewhere` holds the quads another store already sampled, so a merged count holds each subject once. Each record
 * this sample holds is labelled the way every producer labels it: its declared title, the shortest linked body's text, or
 * its id.
 */
export function sliceQuadsPerType(quads: readonly TQuad[], perTypeLimit: number, sampledElsewhere: readonly TQuad[], declared: TSampledDeclarationOf): TClusteredQuads {
	const sampledByType = new Map<string, Set<string>>();
	for (const q of sampledElsewhere) heldSet(sampledByType, q.namedGraph).add(q.subject);
	const subjectsByType = new Map<string, Set<string>>();
	const quadsByType = new Map<string, TQuad[]>();
	const quadsBySubject = new Map<string, TQuad[]>();
	const bodyContentBySubject = new Map<string, string>();
	const parentOf = new Map<string, string>();
	for (const q of quads) {
		heldSet(subjectsByType, q.namedGraph).add(q.subject);
		heldList(quadsByType, q.namedGraph).push(q);
		heldList(quadsBySubject, q.subject).push(q);
		if (q.namedGraph === BODY_LABEL && q.predicate === LinkRelations.CONTENT.rel && typeof q.object === "string") bodyContentBySubject.set(q.subject, q.object);
		if (q.predicate === LinkRelations.PART_OF.rel && q.objectType === q.namedGraph && typeof q.object === "string") parentOf.set(q.subject, q.object);
	}
	const sampledQuads: TQuad[] = [];
	const clusters: TCluster[] = [];
	for (const [type, subjectSet] of subjectsByType) {
		const declaration = declared(type);
		const sortField = declaration?.defaultSort;
		const sortValueOf = (subject: string): string | undefined => {
			const value = quadsBySubject.get(subject)?.find((q) => q.namedGraph === type && q.predicate === sortField)?.object;
			return value === undefined ? undefined : String(value);
		};
		const alreadySampled = heldSet(sampledByType, type);
		const newSubjects = sampleOrder([...subjectSet], parentOf, sortValueOf).filter((s) => !alreadySampled.has(s));
		const kept = Math.max(0, perTypeLimit - alreadySampled.size);
		const keep = new Set([...alreadySampled, ...newSubjects.slice(0, kept)]);
		for (const q of heldList(quadsByType, type)) if (keep.has(q.subject)) sampledQuads.push(q);
		// A record left out under a record the sample holds is counted under that record, so a view draws it there.
		const leftUnder = Map.groupBy(newSubjects.slice(kept), (subject) => parentOf.get(subject));
		const omittedUnder = Object.fromEntries([...leftUnder].flatMap(([parent, left]) => (parent !== undefined && keep.has(parent) ? [[parent, left.length]] : [])));
		// A subject another store sampled labels itself, so this sample labels only the subjects it holds.
		const displayLabels: Record<string, string> = {};
		for (const subject of keep) {
			const held = quadsBySubject.get(subject);
			if (held !== undefined) displayLabels[subject] = displayLabelForQuads(type, subject, held, (b) => bodyContentBySubject.get(b), undefined, declaration?.title);
		}
		const total = alreadySampled.size + subjectSet.size;
		const under = Object.keys(omittedUnder).length > 0 ? { omittedUnder } : {};
		clusters.push({ type, totalCount: total, sampledCount: keep.size, omittedCount: Math.max(0, total - keep.size), sampledSubjects: [...keep], displayLabels, ...under });
	}
	return { quads: sampledQuads, clusters };
}
