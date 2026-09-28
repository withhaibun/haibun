/**
 * Declarative per-frame scheduler for the polymorphic view's rAF loop: each job declares its own cadence instead of the
 * view hand-rolling countdown fields. `every: 1` runs each frame (camera-coupled work like label orientation);
 * a larger cadence samples (watchdogs, bounds). One place to see, and test, everything the frame does.
 */
import { reportFailure } from "../../client-log.js";

type TFrameJob = { name: string; every: number; run: () => void };

export class FrameScheduler {
	private jobs: Array<TFrameJob & { countdown: number }> = [];

	add(name: string, run: () => void, every = 1): void {
		this.jobs.push({ name, run, every: Math.max(1, every), countdown: 1 });
	}

	/** Run one frame: each job fires when its countdown lapses. A throwing job disables itself rather than killing the loop. */
	tick(): void {
		for (const j of this.jobs) {
			if (--j.countdown > 0) continue;
			j.countdown = j.every;
			try {
				j.run();
			} catch (err) {
				j.countdown = Number.POSITIVE_INFINITY;
				reportFailure("polymorphic-frame", `the frame job "${j.name}" failed and is disabled`, err);
			}
		}
	}

	names(): string[] {
		return this.jobs.map((j) => j.name);
	}
}
