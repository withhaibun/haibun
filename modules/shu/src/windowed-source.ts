/**
 * WindowedSource — the data behind a virtualized column, in index space. The renderer asks for the total row count and
 * for the ranges it can see; the source pages windows in and out of a bounded resident cache on demand, so every row of
 * an arbitrarily long set stays reachable. It is renderer-agnostic: the DOM virtualizer and a future 3D chip-mesh rail
 * read the same three calls (count, rowAt, ensureRange), so the same column data can drive both media.
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
export function arrayWindowedSource<T>(
	initial: readonly T[] = [],
	markers: TScrollMarker[] = [],
): WindowedSource<T> & { set(items: readonly T[], markers?: TScrollMarker[]): void } {
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
	} as WindowedSource<T> & { set(items: readonly T[], markers?: TScrollMarker[]): void };
}

/** Fetch the rows for `[start, end)`. May return fewer than requested at the end of the data. */
export type TPageFetcher<T> = (start: number, end: number) => Promise<readonly T[]>;

/** A paged source for data too large to hold resident (up to millions): rows are fetched a page at a time on
 *  ensureRange, cached in a bounded window (pages far from the last request are evicted so memory stays flat regardless
 *  of total), and concurrent or overlapping requests for the same pages coalesce into a single fetch. */
export function lazyWindowedSource<T>(opts: {
	count: () => number;
	fetch: TPageFetcher<T>;
	pageSize?: number;
	maxResidentPages?: number;
	markers?: () => TScrollMarker[];
}): WindowedSource<T> & {
	/** Re-probe the tail and notify: call after `count()` grows (a live append) or a previously-capped fetch can now
	 *  return more, so a partial last page is re-fetched and the view re-renders. */
	notifyCountChanged(): void;
	/** Seed an already-fetched, page-aligned run of rows (the first page the caller fetched to learn the total) so the
	 *  first paint needs no second round-trip. `startRow` must be a multiple of `pageSize`. */
	prime(startRow: number, rows: readonly T[]): void;
	/** A row arrived live at `index` (the source's count has grown to include it): placed into its page when that page is
	 *  resident up to it, so the live edge keeps rendering without a fetch; otherwise left for ensureRange to bring in. */
	append(index: number, row: T): void;
} {
	const pageSize = opts.pageSize ?? 200;
	const maxResidentPages = Math.max(4, opts.maxResidentPages ?? 24);
	const pages = new Map<number, readonly T[]>();
	const inflight = new Map<number, Promise<void>>();
	const subs = new Set<() => void>();
	let dataEnd = Number.POSITIVE_INFINITY; // highest index confirmed to hold data; a fetch that returns fewer rows than asked reveals the true end
	let lastFirst = 0; // the most recent request span, so eviction always centres on the LIVE window, never a completing call's stale closure
	let lastLast = 0;
	const pageOf = (i: number) => Math.floor(i / pageSize);
	const notify = (): void => {
		for (const cb of subs) cb();
	};

	/** A page is resident only when it holds every row it should for the current count and confirmed data end; a partial
	 *  page (a short last page, or a capped fetch) is NOT resident, so a later count growth or a re-probe re-fetches it. */
	function resident(p: number): boolean {
		const rows = pages.get(p);
		if (!rows) return false;
		const wantEnd = Math.min((p + 1) * pageSize, opts.count(), dataEnd);
		return p * pageSize + rows.length >= wantEnd;
	}

	/** Keep the pages in the last-requested [lastFirst, lastLast] span (never evict what the caller is using) plus, up to
	 *  the cap (raised to cover an oversized request), the pages nearest that span; drop the rest. Centres on the LIVE
	 *  request so a slow fetch completing after the reader scrolled away cannot evict an on-screen page. */
	function evict(): void {
		const budget = Math.max(maxResidentPages, lastLast - lastFirst + 1);
		if (pages.size <= budget) return;
		const centre = (lastFirst + lastLast) / 2;
		const dist = (p: number) => (p >= lastFirst && p <= lastLast ? -1 : Math.abs(p - centre));
		const keep = new Set([...pages.keys()].sort((a, b) => dist(a) - dist(b)).slice(0, budget));
		for (const p of [...pages.keys()]) if (!keep.has(p)) pages.delete(p);
	}

	async function fetchSpan(firstPage: number, lastPage: number): Promise<void> {
		const startRow = firstPage * pageSize;
		const endRow = Math.max(startRow, Math.min(opts.count(), (lastPage + 1) * pageSize));
		if (endRow <= startRow) return; // the range fell outside the current count (it shrank); never call fetch with end<=start
		const rows = await opts.fetch(startRow, endRow);
		if (rows.length < endRow - startRow) dataEnd = startRow + rows.length; // the fetch reached the real end of data
		for (let p = firstPage; p <= lastPage; p++) {
			const slice = rows.slice((p - firstPage) * pageSize, (p - firstPage + 1) * pageSize);
			if (slice.length > 0) pages.set(p, slice);
		}
	}

	return {
		count: opts.count,
		rowAt(i) {
			return pages.get(pageOf(i))?.[i % pageSize];
		},
		async ensureRange(start, end) {
			const firstPage = pageOf(start);
			const lastPage = pageOf(Math.max(start, end - 1));
			lastFirst = firstPage;
			lastLast = lastPage;
			// Split the needed pages into contiguous runs of not-resident, not-in-flight pages; each run is one fetch.
			const runs: Array<[number, number]> = [];
			let runStart = -1;
			for (let p = firstPage; p <= lastPage; p++) {
				const missing = !resident(p) && !inflight.has(p);
				if (missing && runStart < 0) runStart = p;
				else if (!missing && runStart >= 0) {
					runs.push([runStart, p - 1]);
					runStart = -1;
				}
			}
			if (runStart >= 0) runs.push([runStart, lastPage]);
			const waits: Promise<void>[] = [];
			for (const [a, b] of runs) {
				// A failed fetch clears its in-flight marks so the next ensureRange retries; the pages stay skeletons, never
				// bricked, and the rejection is swallowed here (best-effort paging) rather than surfacing unhandled.
				const promise = fetchSpan(a, b)
					.then(() => {
						for (let p = a; p <= b; p++) inflight.delete(p);
						evict();
						notify();
					})
					.catch(() => {
						for (let p = a; p <= b; p++) inflight.delete(p);
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
		notifyCountChanged() {
			dataEnd = Number.POSITIVE_INFINITY;
			notify();
		},
		append(index, row) {
			const p = pageOf(index);
			const have = pages.get(p);
			const within = index - p * pageSize;
			if (within === 0 || (have && have.length === within)) {
				// The page is resident up to this row (or begins with it): extend it in place. A short resident page is re-read
				// as partial by `resident()` only against the count, which now includes this row.
				pages.set(p, [...(have ?? []), row]);
				dataEnd = Number.POSITIVE_INFINITY;
			}
			notify();
		},
		prime(startRow, rows) {
			const firstPage = pageOf(startRow); // startRow is page-aligned: the caller fetched from a page boundary
			for (let p = firstPage; p * pageSize < startRow + rows.length; p++) {
				const slice = rows.slice(p * pageSize - startRow, (p + 1) * pageSize - startRow);
				if (slice.length > 0) pages.set(p, slice);
			}
			// If the seed reaches the total, it is the real end of data — record it so the short last page counts as
			// resident instead of being re-fetched.
			if (startRow + rows.length >= opts.count()) dataEnd = startRow + rows.length;
			notify();
		},
	};
}
