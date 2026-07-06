/**
 * Time→depth (z) math: maps each node's age (now − recorded time) onto [0, zMax] on an adaptive log scale, so the
 * axis fills the same range whether the data spans minutes or years — older = deeper. The consuming paint owns
 * when "now" advances (a coarse global tick); this owns the deterministic mapping.
 */
import type { TQuad } from "@haibun/core/lib/quad-types.js";

export type TimeZScale = { logMin: number; logRange: number; zMax: number };

/** A subject's time and the FIELD it came from — the one record every consumer (depth, hover label) reads, so the
 *  fallback decision can never be re-derived differently elsewhere. */
export type TSubjectTime = { ms: number; field: string };

/**
 * Each subject's valid time, from the field its type declares (the hypermedia catalog's validTimeField — where the
 * term is defined). A subject whose declared field is absent from its quads falls back to its generatedAtTime
 * (indexed-time) quad, so an individual always places by its own time and only by indexing time when it carries
 * nothing else. The field lookup is memoized per type, so the resolver runs O(types), not O(quads).
 */
export function subjectValidTimes(quads: TQuad[], validTimeFieldFor: (type: string) => string, indexedTimeField: string): Map<string, TSubjectTime> {
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
	return times;
}

/** Compute the log-age scale for one reference `now` over all record times. Pure; same inputs → same scale. */
export function timeZScale(times: Iterable<number>, nowMs: number, zMax: number): TimeZScale {
	let minAge = Number.POSITIVE_INFINITY;
	let maxAge = 0;
	for (const t of times) {
		const age = Math.max(0, nowMs - t);
		if (age < minAge) minAge = age;
		if (age > maxAge) maxAge = age;
	}
	if (!Number.isFinite(minAge)) minAge = 0;
	const logMin = Math.log(minAge + 1);
	return { logMin, logRange: Math.log(maxAge + 1) - logMin, zMax };
}

/** Map one record time to its z depth under a scale + reference `now`. Pure. */
export function timeZ(recordedMs: number, nowMs: number, scale: TimeZScale): number {
	const age = Math.max(0, nowMs - recordedMs);
	return scale.logRange > 0 ? Math.max(0, (Math.log(age + 1) - scale.logMin) / scale.logRange) * scale.zMax : 0;
}
