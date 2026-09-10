/**
 * Render-stage timing for the polymorphic view. Attributes the synchronous main-thread cost of reaching a settled layout to
 * three stages, accumulated since the last reset (one limit change triggers a refetch and several repaints; the totals
 * across them are the cost):
 *   - compute: toGraphData (time extraction + model build)
 *   - force:   the synchronous force warmup the library runs when graphData is set (derived: set − labels)
 *   - labels:  the per-node object build (each node's canvas raster + GPU texture upload), accrued whenever the
 *              library builds a node object, synchronous within the set or deferred to a later digest
 * Always on (performance.now is fast); `profile` is the running total, surfaced through the view's inspect().
 */
export type TRenderProfile = { nodes: number; repaints: number; computeMs: number; setMs: number; labelsMs: number };

export class PolymorphicProfiler {
	private nodes = 0;
	private repaints = 0;
	private computeMs = 0;
	private setMs = 0;
	private labelsMs = 0;

	/** Zero the totals so the next window (e.g. one limit change) is measured in isolation. */
	reset(): void {
		this.nodes = this.repaints = 0;
		this.computeMs = this.setMs = this.labelsMs = 0;
	}

	/** Time the pure compute stage (toGraphData), returning its result. */
	compute<T>(fn: () => T): T {
		const t = performance.now();
		const result = fn();
		this.computeMs += performance.now() - t;
		return result;
	}

	/** Time the graphData set, the synchronous force warmup (and any node builds the library runs inline), for a feed of `nodes`. */
	set(nodes: number, fn: () => void): void {
		const t = performance.now();
		fn();
		this.setMs += performance.now() - t;
		this.repaints++;
		this.nodes = nodes;
	}

	/** Time one node-object build (its label texture is the cost) into the label total, whenever the library builds it. */
	node<T>(build: () => T): T {
		const t = performance.now();
		const obj = build();
		this.labelsMs += performance.now() - t;
		return obj;
	}

	get profile(): TRenderProfile {
		return { nodes: this.nodes, repaints: this.repaints, computeMs: this.computeMs, setMs: this.setMs, labelsMs: this.labelsMs };
	}
}
