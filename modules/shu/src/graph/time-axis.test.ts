import { describe, it, expect } from "vitest";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { timeZScale, timeZ, subjectValidTimes } from "./time-axis.js";

const LOG_Z_MAX = 320;
// A fixed age ladder (ms before "now"): 30s, 1h, 1d, 30d, 1y.
const NOW = 1_780_000_000_000;
const AGES = { s30: 30_000, h1: 3_600_000, d1: 86_400_000, d30: 2_592_000_000, y1: 31_536_000_000 };
const times = Object.values(AGES).map((a) => NOW - a);

describe("3D time→z (headless layout math, no browser)", () => {
	it("is monotonic: older records sit deeper (larger z)", () => {
		const scale = timeZScale(times, NOW, LOG_Z_MAX);
		const z = times.map((t) => timeZ(t, NOW, scale));
		for (let i = 1; i < z.length; i++) expect(z[i], `older index ${i} deeper than ${i - 1}`).toBeGreaterThan(z[i - 1]);
	});

	it("bounds z to [0, zMax] across the span", () => {
		const scale = timeZScale(times, NOW, LOG_Z_MAX);
		for (const t of times) {
			const z = timeZ(t, NOW, scale);
			expect(z).toBeGreaterThanOrEqual(0);
			expect(z).toBeLessThanOrEqual(LOG_Z_MAX);
		}
	});

	it("is deterministic: the SAME `now` yields identical z across repeated computes (no per-repaint drift when the reference is held)", () => {
		const a = times.map((t) => timeZ(t, NOW, timeZScale(times, NOW, LOG_Z_MAX)));
		const b = times.map((t) => timeZ(t, NOW, timeZScale(times, NOW, LOG_Z_MAX)));
		expect(b).toEqual(a); // this is exactly why a stable referenceNow keeps the graph from sliding between repaints
	});

	it("z-drift from a `now` advance is NEGLIGIBLE on the log scale — so a per-repaint clock is NOT the select-jump", () => {
		// A 5s advance (a couple of repaints' worth of fresh Date.now()) over a 30s..1y span.
		const s0 = timeZScale(times, NOW, LOG_Z_MAX);
		const s1 = timeZScale(times, NOW + 5_000, LOG_Z_MAX);
		let maxDrift = 0;
		for (const t of times) maxDrift = Math.max(maxDrift, Math.abs(timeZ(t, NOW + 5_000, s1) - timeZ(t, NOW, s0)));
		expect(maxDrift, `max z-drift over 5s = ${maxDrift.toFixed(3)} of ${LOG_Z_MAX}`).toBeLessThan(3); // tiny vs the 320-unit depth — disproves the z-drift theory of the jump
	});

	it("a single record (zero age span) places it at z=0, no NaN", () => {
		const one = [NOW - AGES.h1];
		expect(timeZ(one[0], NOW, timeZScale(one, NOW, LOG_Z_MAX))).toBe(0);
	});
});

describe("subject valid times: an object places by when it happened, not when it was indexed", () => {
	const quad = (subject: string, namedGraph: string, predicate: string, object: string): TQuad => ({ subject, namedGraph, predicate, object, timestamp: 0 });
	const fieldFor = (type: string) => (type === "Email" ? "dateReceived" : "generatedAtTime");

	it("uses the type's declared valid-time field, and generatedAtTime only as the fallback", () => {
		const quads = [
			quad("e1", "Email", "dateReceived", "2025-04-05T10:00:00.000Z"),
			quad("e1", "Email", "generatedAtTime", "2026-07-04T00:00:00.000Z"),
			quad("e2", "Email", "generatedAtTime", "2026-07-04T00:00:00.000Z"),
			quad("c1", "Comment", "generatedAtTime", "2026-01-01T00:00:00.000Z"),
		];
		const times = subjectValidTimes(quads, fieldFor, "generatedAtTime");
		expect(times.get("e1")).toBe(Date.parse("2025-04-05T10:00:00.000Z"));
		expect(times.get("e2")).toBe(Date.parse("2026-07-04T00:00:00.000Z"));
		expect(times.get("c1")).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
	});

	it("ignores unparseable values and unrelated predicates", () => {
		const quads = [quad("e1", "Email", "dateReceived", "not a date"), quad("e1", "Email", "subject", "hello")];
		expect(subjectValidTimes(quads, fieldFor, "generatedAtTime").size).toBe(0);
	});
});
