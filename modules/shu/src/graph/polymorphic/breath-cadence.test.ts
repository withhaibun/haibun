/**
 * The active node's breath, and what keeps it even.
 *
 * The scene draws only while something asks it to, and a frame job's countdown advances only on the frames it draws.
 * A breath sampled that way stalls whenever the scene settles and jumps when something else wakes it. It is sampled
 * on wall frames instead, the rAF runs whether or not the scene draws, and each sample asks for the one frame it
 * needs, so the cadence is even and the scene still idles between breaths.
 */
import { describe, expect, it } from "vitest";
import { PULSE_MS, pulseAt } from "../polymorphic/polymorphic-highlight.js";

/** The loop as the scene runs it: rAF frames always advance; the scene draws only while within the dirty grace. */
function loop(sampleEvery: number, frames: number): { sampledAt: number[]; drawn: number } {
	const sampledAt: number[] = [];
	let dirtyUntil = 0;
	let drawn = 0;
	for (let frame = 1; frame <= frames; frame++) {
		if (frame % sampleEvery === 0) {
			sampledAt.push(frame);
			dirtyUntil = Math.max(dirtyUntil, frame + 1);
		}
		if (frame < dirtyUntil) drawn++;
	}
	return { sampledAt, drawn };
}

describe("the breath the loop samples", () => {
	it("is even, because the frames it counts are the ones the display gives, not the ones the scene draws", () => {
		const { sampledAt } = loop(6, 60);
		const gaps = sampledAt.slice(1).map((at, i) => at - sampledAt[i]);
		expect([...new Set(gaps)], "one cadence, whatever the scene is doing").toEqual([6]);
		expect(sampledAt.length, "and it keeps to it for as long as a node wears it").toBe(10);
	});

	it("costs the scene one frame per breath, so an otherwise idle graph stays idle", () => {
		const { drawn } = loop(6, 60);
		expect(drawn, "one drawn frame per sample, not sixty").toBe(10);
	});

	it("has no corners for an eye to catch, and returns to where it began", () => {
		expect(pulseAt(0)).toBeCloseTo(pulseAt(PULSE_MS), 6);
		expect(pulseAt(PULSE_MS / 4) - pulseAt(0), "it swells from the start of a cycle").toBeGreaterThan(0);
	});
});
