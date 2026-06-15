/**
 * Time→depth (z) math: maps each node's age (now − recorded time) onto [0, zMax] on an adaptive log scale, so the
 * axis fills the same range whether the data spans minutes or years — older = deeper. The consuming paint owns
 * when "now" advances (a coarse global tick); this owns the deterministic mapping.
 */
export type TimeZScale = { logMin: number; logRange: number; zMax: number };

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
