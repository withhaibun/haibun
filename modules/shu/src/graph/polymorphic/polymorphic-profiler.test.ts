import { describe, expect, it } from "vitest";
import { FisheyeProfiler } from "./polymorphic-profiler.js";

/** A monotonic fake clock so the stage attributions are exact, not wall-clock-dependent. */
function withFakeClock(run: (tick: (ms: number) => void) => void): void {
	const original = performance.now;
	let t = 0;
	performance.now = () => t;
	try {
		run((ms) => {
			t += ms;
		});
	} finally {
		performance.now = original;
	}
}

describe("FisheyeProfiler", () => {
	it("attributes each stage's elapsed time and accumulates across repaints since reset", () => {
		withFakeClock((tick) => {
			const p = new FisheyeProfiler();
			// First repaint: 2ms compute, two node builds (3ms + 1ms), a 10ms graphData set.
			p.compute(() => tick(2));
			p.node(() => tick(3));
			p.node(() => tick(1));
			p.set(5, () => tick(10));
			// Second repaint at the same limit window: 1ms compute, one 4ms node build, an 8ms set.
			p.compute(() => tick(1));
			p.node(() => tick(4));
			p.set(5, () => tick(8));

			expect(p.profile).toEqual({ nodes: 5, repaints: 2, computeMs: 3, setMs: 18, labelsMs: 8 });
		});
	});

	it("reset zeroes the totals so a new window is measured in isolation", () => {
		withFakeClock((tick) => {
			const p = new FisheyeProfiler();
			p.compute(() => tick(5));
			p.set(3, () => tick(7));
			p.reset();
			p.compute(() => tick(1));
			p.node(() => tick(2));
			p.set(9, () => tick(4));

			expect(p.profile).toEqual({ nodes: 9, repaints: 1, computeMs: 1, setMs: 4, labelsMs: 2 });
		});
	});

	it("passes each wrapped stage's own return value through unchanged", () => {
		const p = new FisheyeProfiler();
		expect(p.compute(() => ({ nodes: [1, 2] }))).toEqual({ nodes: [1, 2] });
		expect(p.node(() => "sprite")).toBe("sprite");
	});
});
