/**
 * WindowedSource — the data behind a virtualized column, in index space. The renderer asks for the total row count and
 * for the ranges it can see; the source pages windows in and out of a bounded resident cache on demand, instead of the
 * old `windowTail` cap that simply dropped every row past 500. It is renderer-agnostic: the DOM virtualizer and a future
 * 3D chip-mesh rail read the same three calls (count, rowAt, ensureRange), so the same column data can drive both media.
 */
import type { TScrollMarker } from "./scrollbar-model.js";

export interface WindowedSource<T> {
	/** Total rows. May be an estimate for a server-counted or still-arriving set of millions. */
	count(): number;
	/** The row at `index`: resident → the row, not yet fetched → undefined (the renderer paints a skeleton; ensureRange brings it in). */
	rowAt(index: number): T | undefined;
	/** Prefetch `[start, end)`. Coalesces contiguous missing pages into one fetch, never re-fetches resident or in-flight pages, and resolves once the range is resident. */
	ensureRange(start: number, end: number): Promise<void>;
	/** Notify on data arrival, count change, or live append; returns an unsubscribe. */
	subscribe(cb: () => void): () => void;
	/** Significant rows to mark on the scroll rail (annotations, failed steps, feature boundaries), across the whole set. */
	markers(): TScrollMarker[];
}

/** A source over data already resident in memory (a fetched page of query results, a finite in-memory list): every row
 *  is available and ensureRange is a no-op. `set` swaps the backing list and notifies (a live re-query). */
export function arrayWindowedSource<T>(initial: readonly T[] = [], markers: TScrollMarker[] = []): WindowedSource<T> & { set(items: readonly T[]): void } {
	const subs = new Set<() => void>();
	let items = initial;
	let marks = markers;
	return {
		count: () => items.length,
		rowAt: (i) => items[i],
		ensureRange: async () => {
			/* resident: every row is already in memory, nothing to fetch */
		},
		subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)),
		markers: () => marks,
		set(next: readonly T[], nextMarks?: TScrollMarker[]) {
			items = next;
			if (nextMarks) marks = nextMarks;
			for (const cb of subs) cb();
		},
	} as WindowedSource<T> & { set(items: readonly T[]): void };
}

/** Fetch the rows for `[start, end)`. May return fewer than requested at the end of the data. */
export type TPageFetcher<T> = (start: number, end: number) => Promise<readonly T[]>;

/** A paged source for data too large to hold resident (up to millions): rows are fetched a page at a time on
 *  ensureRange, cached in a bounded window (pages far from the last request are evicted so memory stays flat regardless
 *  of total), and concurrent or overlapping requests for the same pages coalesce into a single fetch. */
export function lazyWindowedSource<T>(opts: { count: () => number; fetch: TPageFetcher<T>; pageSize?: number; maxResidentPages?: number; markers?: () => TScrollMarker[] }): WindowedSource<T> {
	const pageSize = opts.pageSize ?? 200;
	const maxResidentPages = Math.max(4, opts.maxResidentPages ?? 24);
	const pages = new Map<number, readonly T[]>();
	const inflight = new Map<number, Promise<void>>();
	const subs = new Set<() => void>();
	const pageOf = (i: number) => Math.floor(i / pageSize);
	const notify = (): void => {
		for (const cb of subs) cb();
	};

	/** Keep the `maxResidentPages` pages nearest `centre`; drop the rest so the resident set never grows with the total. */
	function evict(centre: number): void {
		if (pages.size <= maxResidentPages) return;
		const kept = [...pages.keys()].sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, maxResidentPages);
		const keep = new Set(kept);
		for (const p of [...pages.keys()]) if (!keep.has(p)) pages.delete(p);
	}

	async function fetchSpan(firstPage: number, lastPage: number): Promise<void> {
		const rows = await opts.fetch(firstPage * pageSize, Math.min(opts.count(), (lastPage + 1) * pageSize));
		for (let p = firstPage; p <= lastPage; p++) pages.set(p, rows.slice((p - firstPage) * pageSize, (p - firstPage + 1) * pageSize));
	}

	return {
		count: opts.count,
		rowAt(i) {
			return pages.get(pageOf(i))?.[i % pageSize];
		},
		async ensureRange(start, end) {
			const firstPage = pageOf(start);
			const lastPage = pageOf(Math.max(start, end - 1));
			// Split the needed pages into contiguous runs of missing, not-in-flight pages; each run is one fetch.
			const runs: Array<[number, number]> = [];
			let runStart = -1;
			for (let p = firstPage; p <= lastPage; p++) {
				const missing = !pages.has(p) && !inflight.has(p);
				if (missing && runStart < 0) runStart = p;
				else if (!missing && runStart >= 0) {
					runs.push([runStart, p - 1]);
					runStart = -1;
				}
			}
			if (runStart >= 0) runs.push([runStart, lastPage]);
			const waits: Promise<void>[] = [];
			for (const [a, b] of runs) {
				const promise = fetchSpan(a, b).then(() => {
					for (let p = a; p <= b; p++) inflight.delete(p);
					evict(pageOf(start));
					notify();
				});
				for (let p = a; p <= b; p++) inflight.set(p, promise);
				waits.push(promise);
			}
			for (let p = firstPage; p <= lastPage; p++) {
				const f = inflight.get(p);
				if (f && !waits.includes(f)) waits.push(f);
			}
			await Promise.all(waits);
		},
		subscribe(cb) {
			subs.add(cb);
			return () => subs.delete(cb);
		},
		markers: opts.markers ?? (() => []),
	};
}
