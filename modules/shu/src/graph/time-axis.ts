/**
 * Time→depth (z) math: maps each node's age (now − recorded time) onto [0, zMax] on an adaptive sqrt scale normalized
 * to the data's own min..max age, so the axis fills the full range whatever the span (minutes or years) AND a long gap
 * reads clearly deeper than a short one — sqrt keeps a big elapsed gap visibly bigger than a small one (a plain log
 * flattens the old end; a plain linear packs dense recent clusters). Older = deeper. The consuming paint owns when
 * "now" advances (a coarse global tick); this owns the deterministic mapping.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";

export type TimeZScale = { base: number; range: number; zMax: number };

/** A subject's time and the FIELD it came from — the one record every consumer (depth, hover label) reads, so the
 *  fallback decision can never be re-derived differently elsewhere. */
export type TSubjectTime = { ms: number; field: string };

/**
 * Each subject's valid time, from the field its type declares (the hypermedia catalog's validTimeField — where the
 * term is defined). A subject whose declared field is absent from its quads falls back to its generatedAtTime
 * (indexed-time) quad, so an individual always places by its own time and only by indexing time when it carries
 * nothing else. The field lookup is memoized per type, so the resolver runs O(types), not O(quads).
 */
export function subjectValidTimes(quads: TQuad[], validTimeFieldFor: (type: string) => string, indexedTimeField: string): TSubjectTimes {
	const fieldByType = new Map<string, string>();
	const times = new Map<string, TSubjectTime>();
	const fallback = new Map<string, TSubjectTime>();
	for (const q of quads) {
		if (typeof q.object !== "string") continue;
		let field = fieldByType.get(q.namedGraph);
		if (field === undefined) {
			field = validTimeFieldFor(q.namedGraph);
			fieldByType.set(q.namedGraph, field);
		}
		const target = q.predicate === field ? times : q.predicate === indexedTimeField ? fallback : undefined;
		if (!target) continue;
		const t = Date.parse(q.object);
		if (!Number.isNaN(t)) target.set(q.subject, { ms: t, field: q.predicate });
	}
	for (const [subject, entry] of fallback) if (!times.has(subject)) times.set(subject, entry);
	// Both maps come out of the one pass: what a subject is ABOUT (its declared valid time, falling back to when it was
	// written down) and when it was written down. A caller wanting the second walked every quad again to build it.
	return { times, indexed: fallback };
}

/** What one pass over the quads says about time per subject: the valid times, and when each was written down. */
export type TSubjectTimes = { times: Map<string, TSubjectTime>; indexed: Map<string, TSubjectTime> };

/** Compute the sqrt-age scale for one reference `now` over all record times: the raw-value scale over each age
 *  (now − time). Pure; same inputs → same scale. The sqrt-normalize itself lives once, in spanZScale/spanZ. */
export function timeZScale(times: Iterable<number>, nowMs: number, zMax: number): TimeZScale {
	return spanZScale(ages(times, nowMs), zMax);
}

/** Map one record time to its z depth under a scale + reference `now`: the raw-value mapping of its age. Pure. */
export function timeZ(recordedMs: number, nowMs: number, scale: TimeZScale): number {
	return spanZ(Math.max(0, nowMs - recordedMs), scale);
}

function* ages(times: Iterable<number>, nowMs: number): Iterable<number> {
	for (const t of times) yield Math.max(0, nowMs - t);
}

/** A sqrt scale over raw values (an age, a node degree), normalized to their own min..max → [0, zMax]; the ONE place
 *  the sqrt-normalize shape lives. The time bases feed it ages; the connections basis feeds it degree counts. */
export function spanZScale(values: Iterable<number>, zMax: number): TimeZScale {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (!Number.isFinite(min)) {
		min = 0;
		max = 0;
	}
	const base = Math.sqrt(Math.max(0, min));
	return { base, range: Math.sqrt(Math.max(0, max)) - base, zMax };
}

/** Map one raw value to z under a spanZScale (bigger value = bigger z). Pure. */
export function spanZ(value: number, scale: TimeZScale): number {
	return scale.range > 0 ? Math.max(0, (Math.sqrt(Math.max(0, value)) - scale.base) / scale.range) * scale.zMax : 0;
}
