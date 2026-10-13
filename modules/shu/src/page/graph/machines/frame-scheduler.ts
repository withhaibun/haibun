

type TFrameJob = { name: string; every: number; run: () => void };

/** Runs the frame's jobs. A job that throws is disabled, and `failed` reports it with the job's name. */
export class FrameScheduler {
	private jobs: Array<TFrameJob & { countdown: number }> = [];

	constructor(private readonly failed: (name: string, err: unknown) => void) {}

	add(name: string, run: () => void, every: number): void {
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
				this.failed(j.name, err);
			}
		}
	}

	names(): string[] {
		return this.jobs.map((j) => j.name);
	}
}
