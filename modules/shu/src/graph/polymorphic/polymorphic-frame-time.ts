/**
 * What a drawn frame costs the renderer, measured from the page without stalling it.
 *
 * The main thread cannot measure the cost: `render()` returns in half a millisecond once the commands are queued, and
 * the work is done in the browser's GPU process, by a GPU or by a software rasterizer. A WebGL2 fence placed after the
 * draw signals when that work is complete, and polling it on later frames costs nothing, so the time from the fence to
 * its signal is the frame's cost as the renderer spent it: one to two milliseconds on a GPU, sixteen and more under
 * SwiftShader for the same scene.
 *
 * One frame in `SAMPLE_EVERY` is measured, one fence at a time. A context without fences measures nothing, and the
 * regulator that reads this then never trips.
 */

/** The slice of a WebGL2 context a fence needs. */
export type TFenceGl = {
	SYNC_GPU_COMMANDS_COMPLETE: number;
	SYNC_STATUS: number;
	SIGNALED: number;
	fenceSync(condition: number, flags: number): unknown;
	getSyncParameter(sync: unknown, pname: number): unknown;
	deleteSync(sync: unknown): void;
	flush(): void;
};

/** Drawn frames between measurements. */
export const SAMPLE_EVERY = 10;

export class FrameCost {
	#drawn = 0;
	#pending: { fence: unknown; placedAt: number } | undefined;
	#gl: TFenceGl | null | undefined;

	/** `context` is read lazily and once: a scene's renderer exists only after the scene has loaded. */
	constructor(
		private readonly context: () => TFenceGl | undefined,
		private readonly now: () => number = () => performance.now(),
	) {}

	/** A frame was drawn. On every `SAMPLE_EVERY`th, with no measurement pending, a fence is placed after it. */
	drew(): void {
		this.#drawn++;
		if (this.#pending || this.#drawn % SAMPLE_EVERY !== 0) return;
		const gl = this.gl();
		if (!gl) return;
		const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		this.#pending = { fence, placedAt: this.now() };
	}

	/** Returns the cost of a completed measurement once, in milliseconds, and undefined otherwise. Polled each tick. */
	poll(): number | undefined {
		const gl = this.gl();
		if (!this.#pending || !gl) return undefined;
		if (gl.getSyncParameter(this.#pending.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return undefined;
		const cost = this.now() - this.#pending.placedAt;
		gl.deleteSync(this.#pending.fence);
		this.#pending = undefined;
		return cost;
	}

	/** The scene is going away: a pending fence is released. */
	end(): void {
		if (!this.#pending) return;
		this.gl()?.deleteSync(this.#pending.fence);
		this.#pending = undefined;
	}

	private gl(): TFenceGl | undefined {
		if (this.#gl === undefined) {
			const c = this.context();
			this.#gl = c && typeof c.fenceSync === "function" ? c : c === undefined ? undefined : null;
		}
		return this.#gl ?? undefined;
	}
}
