/**
 * WindowedSource: the data behind a virtualized column, in index space. The renderer requests the total row count and
 * for the ranges it can see; the source pages windows in and out of a bounded cached cache on demand, so every row of
 * an arbitrarily long set stays reachable. It is renderer-agnostic: the DOM virtualizer and a future 3D chip-mesh rail
 * read the same three calls (count, rowAt, ensureRange), so the same column data can drive both media.
 */
import { counted, readInPages, type TCounted, type TCountedPage } from "@haibun/core/lib/hypermedia.js";
import type { TScrollMarker } from "./scrollbar-model.js";
import type { Range } from "./ranges.js";

export interface WindowedSource<T> {
	/** Total rows. May be an estimate for a server-counted or still-arriving set of millions. */
	count(): number;
	/** Returns the count a view renders. The count is a floor where the read stopped counting at a ceiling and the source
	 *  hasn't read to the end of the data. A source without this method counts exactly. */
	stated?(): TCounted;
	/** The row at `index`: cached → the row, not yet fetched → undefined (the renderer paints a skeleton; ensureRange delivers it in). */
	rowAt(index: number): T | undefined;
	/** Prefetch `[start, end)`. Coalesces contiguous missing pages into one fetch, never re-fetches cached or in-flight pages, and resolves once the range is cached. */
	ensureRange(start: number, end: number): Promise<void>;
	/** Notify on data arrival, count change, or live append; returns an unsubscribe. */
	subscribe(cb: () => void): () => void;
	/** Significant rows to mark on the scroll rail (annotations, failed steps, feature boundaries), across the whole set. */
	markers(): TScrollMarker[];
	/** The size of a row known without rendering it: 0 for a cached empty row, so the renderer doesn't give it
	 *  room and does not let it drag its estimate of the rows it has not measured; undefined to measure and estimate. */
	rowSize?(index: number): number | undefined;
	/** The rail this source's rows sit on, where the rows are a window of something longer. A source that doesn't offer one
	 *  has a rail of its own rows, spread evenly. */
	rail?: TSourceRail;
}

/** Returns `source.stated()` where the source implements it. Returns the exact count otherwise. */
export const statedCountOf = (source: WindowedSource<unknown>): TCounted => source.stated?.() ?? counted(source.count());

/**
 * A rail over the whole of what a source is a window of.
 *
 * A window holds a few thousand rows and the set can be a year of them, so a rail that spread the window evenly would
 * not describe the rest. The source states the rail instead: how many places it has, where each row it holds sits
 * among them, what marks the whole set puts on it, and what a press on a place asks the set for. The renderer draws
 * places and doesn't depend on what they mean.
 */
type TSourceRail = {
	/** How many places the rail has. A place is what a mark sits at and what a press names. */
	readonly places: number;
	/** Where the row at `index` sits among those places. */
	placeOf(index: number): number;
	/** What the whole set marks on the rail, at their places. */
	marks(): TScrollMarker[];
	/** A reader pressed a place: what the set does about it (a run reads itself around the moment that place names). */
	goTo(place: number): void;
};

/** A source over data already cached in memory (a fetched page of query results, a finite in-memory list): every row
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
			/* cached: every row is already in memory, so this doesn't fetch */
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

/** Fetch the rows for `[start, end)`. Returns fewer than requested only at the end of the data. A paged source requests at
 *  most `MAX_PAGE_ROWS` rows in one call. */
type TPageFetcher<T> = (start: number, end: number) => Promise<readonly T[]>;

/** Reads the rows for `[start, end)` with the count of the read. */
type TCountedFetcher<T> = (start: number, end: number) => Promise<TCountedPage<T>>;

/** Returns the count a page states. */
const countOf = ({ total, saturated }: TCounted): TCounted => ({ total, saturated });

/** A paged source for data too large to cache cached (up to millions): rows are fetched a page at a time on
 *  ensureRange, cached in a bounded window (pages far from the last request are evicted so memory stays flat regardless
 *  of total), and concurrent or overlapping requests for the same pages coalesce into a single fetch. */
export function lazyWindowedSource<T>(opts: {
	count: () => number;
	fetch: TPageFetcher<T>;
	pageSize?: number;
	maxResidentPages?: number;
	markers?: () => TScrollMarker[];
}): TPagedSource<T> {
	const { count, fetch, ...rest } = opts;
	return makePagedSource({ ...rest, counted: () => counted(count()), fetch: async (start, end) => ({ vertices: await fetch(start, end), ...counted(count()) }) });
}

/** A source that fetches its rows, with what a caller that fetches them itself needs of it. */
type TPagedSource<T> = WindowedSource<T> & {
	stated(): TCounted;
	/** Re-probe the tail and notify: call after `count()` grows (a live append), so a partial last page reads the rows past
	 *  those it holds and the view re-renders. */
	notifyCountChanged(): void;
	/** Seed an already-fetched, page-aligned run of rows (the first page the caller fetched to record the total) so the
	 *  first paint doesn't need a second round-trip. `startRow` must be a multiple of `pageSize`. */
	prime(startRow: number, rows: readonly T[]): void;
	/** A row arrived live at `index` (the source's count has grown to include it): placed into its page when that page is
	 *  cached up to it, so the live edge caches rendering without a fetch; cached aside while that page is being fetched and
	 *  placed once the fetch lands, so a live edge under a steady stream is never a short page fetched again and again;
	 *  otherwise left for ensureRange to deliver in. */
	append(index: number, row: T): void;
	/** The index spans cached, in order, as half-open [from, to) ranges: what a view derives marks or a cursor
	 *  from without scanning the whole extent for the rows it caches. */
	cachedRanges(): Range[];
};

type TPagedSourceOptions<T> = { counted: () => TCounted; fetch: TCountedFetcher<T>; pageSize?: number; maxResidentPages?: number; markers?: () => TScrollMarker[] };

function makePagedSource<T>(opts: TPagedSourceOptions<T>): TPagedSource<T> {
	const pageSize = opts.pageSize ?? 200;
	const maxResidentPages = Math.max(4, opts.maxResidentPages ?? 24);
	const pages = new Map<number, readonly T[]>();
	const inflight = new Map<number, Promise<void>>();
	const arrived = new Map<number, Map<number, T>>(); // live rows for a page being fetched, by their offset in it, placed when the fetch lands
	const subs = new Set<() => void>();
	let dataEnd = Number.POSITIVE_INFINITY; // highest index confirmed to cache data; a fetch that returns fewer rows than requested reveals the true end
	let lastFirst = 0; // the most recent request span, so eviction always centres on the LIVE window, never a completing call's stale closure
	let lastLast = 0;
	let readEnd = 0; // the index after the last row a read returned
	const pageOf = (i: number) => Math.floor(i / pageSize);
	/** A saturated count is a floor. count() extends one page past the rows read until a read reaches the end of the data,
	 *  so a view reaches the rows past the ceiling. */
	const open = (): boolean => opts.counted().saturated && dataEnd === Number.POSITIVE_INFINITY;
	const count = (): number => {
		const { total, saturated } = opts.counted();
		if (!saturated) return total;
		return open() ? Math.max(total, readEnd + pageSize) : dataEnd;
	};
	const stated = (): TCounted => {
		const { total, saturated } = opts.counted();
		if (!saturated) return counted(total);
		return open() ? { total: Math.max(total, readEnd), saturated } : counted(dataEnd);
	};
	const notify = (): void => {
		for (const cb of subs) cb();
	};

	/** A page is cached only when it caches every row it should for the current count and confirmed data end; a partial
	 *  page (a short last page, or a seed shorter than a page) is NOT cached, so a later count growth or a re-probe reads
	 *  the rows past those it holds. */
	function cached(p: number): boolean {
		const rows = pages.get(p);
		if (!rows) return false;
		const wantEnd = Math.min((p + 1) * pageSize, count(), dataEnd);
		return p * pageSize + rows.length >= wantEnd;
	}

	/** Keep the pages in the last-requested [lastFirst, lastLast] span (never evict what the caller is using) plus, up to
	 *  the cap (raised to cover an oversized request), the pages nearest that span; drop the rest. Centres on the LIVE
	 *  request so a slow fetch completing after the reader scrolled away cannot evict an on-screen page. */
	function evict(): void {
		const limit = Math.max(maxResidentPages, lastLast - lastFirst + 1);
		if (pages.size <= limit) return;
		const centre = (lastFirst + lastLast) / 2;
		const dist = (p: number) => (p >= lastFirst && p <= lastLast ? -1 : Math.abs(p - centre));
		const keep = new Set([...pages.keys()].sort((a, b) => dist(a) - dist(b)).slice(0, limit));
		for (const p of [...pages.keys()]) if (!keep.has(p)) pages.delete(p);
	}

	async function fetchSpan(firstPage: number, lastPage: number): Promise<void> {
		const startRow = firstPage * pageSize;
		const endRow = Math.max(startRow, Math.min(count(), (lastPage + 1) * pageSize));
		if (endRow <= startRow) return; // the range fell outside the current count (it shrank); never call fetch with end<=start
		// A partial first page holds that page's first rows, so the read starts after them.
		const held = pages.get(firstPage) ?? [];
		const rows = [...held, ...(await readInPages(opts.fetch, startRow + held.length, endRow)).vertices];
		readEnd = Math.max(readEnd, startRow + rows.length);
		if (rows.length < endRow - startRow) dataEnd = startRow + rows.length; // the read reached the end of the data
		for (let p = firstPage; p <= lastPage; p++) {
			const fetched = rows.slice((p - firstPage) * pageSize, (p - firstPage + 1) * pageSize);
			// The rows that arrived live while this page was in flight follow what the fetch delivered, in order: a live row the
			// fetch already included is the same row at the same offset, and is not placed twice; one past a gap waits for the
			// next fetch with the gap.
			const slice = [...fetched];
			const late = arrived.get(p);
			arrived.delete(p);
			if (late) for (let within = slice.length; late.has(within); within++) slice.push(late.get(within) as T);
			if (slice.length > 0) pages.set(p, slice);
			if (slice.length > fetched.length) dataEnd = Number.POSITIVE_INFINITY; // live rows carried the page past the fetched end
		}
	}

	return {
		count,
		stated,
		rowAt(i) {
			return pages.get(pageOf(i))?.[i % pageSize];
		},
		async ensureRange(start, end) {
			const firstPage = pageOf(start);
			const lastPage = pageOf(Math.max(start, end - 1));
			lastFirst = firstPage;
			lastLast = lastPage;
			// Split the needed pages into contiguous runs of not-cached, not-in-flight pages; each run is one fetch.
			const runs: Array<[number, number]> = [];
			let runStart = -1;
			for (let p = firstPage; p <= lastPage; p++) {
				const missing = !cached(p) && !inflight.has(p);
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
				// bricked, and the rejection is discarded here (best-effort paging) rather than surfacing unhandled.
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
			if (inflight.has(p)) {
				// Its page is being fetched: cached for when the fetch lands, so the page is whole then rather than short and
				// fetched again, under a steady stream that would never settle.
				if (!arrived.has(p)) arrived.set(p, new Map());
				arrived.get(p)?.set(within, row);
			} else if (within === 0 || (have && have.length === within)) {
				// The page is cached up to this row (or begins with it): extend it in place. A short cached page is re-read
				// as partial by `cached()` only against the count, which now includes this row.
				pages.set(p, [...(have ?? []), row]);
				dataEnd = Number.POSITIVE_INFINITY;
			}
			notify();
		},
		cachedRanges() {
			const out: Range[] = [];
			for (const p of [...pages.keys()].sort((a, b) => a - b)) {
				const from = p * pageSize;
				const to = from + (pages.get(p)?.length ?? 0);
				const last = out[out.length - 1];
				if (last && last.to === from) last.to = to;
				else out.push({ from, to });
			}
			return out;
		},
		prime(startRow, rows) {
			// A seed beginning inside a page covers that page in part, and a part of a page cached as the page would put
			// its rows at indexes they are not at. Only the pages the seed covers from their first row are cached; the
			// page it begins inside is left for ensureRange to read whole.
			for (let p = pageOf(startRow); p * pageSize < startRow + rows.length; p++) {
				const within = p * pageSize - startRow;
				if (within < 0) continue;
				const slice = rows.slice(within, within + pageSize);
				if (slice.length > 0) pages.set(p, slice);
			}
			readEnd = Math.max(readEnd, startRow + rows.length);
			// If the seed reaches the total, it is the real end of data, record it so the short last page counts as
			// cached instead of being re-fetched.
			if (startRow + rows.length >= count()) dataEnd = startRow + rows.length;
			notify();
		},
	};
}

/**
 * A source over a read that returns a page at a time, with the page the caller has already read placed in it. Every view
 * that lists the records of a read builds its source this way: the size of a page, the read of one page, and the page in
 * hand. The count is the count of the latest page a read returned, so a page that reaches the end of the data states the
 * exact count. A view that lists rows doesn't hold paging of its own.
 */
export function readWindowedSource<T>(opts: {
	/** How many rows a page holds. The first read requests at most this many. */
	size: number;
	/** Reads the rows for [from, to) with the read's count. */
	read: TCountedFetcher<T>;
	/** The page already read. A page shorter than `size` holds the first rows of its page, and the source reads the rest of the
	 *  page after them. */
	held: TCountedPage<T>;
	/** The row the held page starts with. */
	from?: number;
	markers?: () => TScrollMarker[];
}): TPagedSource<T> {
	let latest = countOf(opts.held);
	const read: TCountedFetcher<T> = async (start, end) => {
		const page = await opts.read(start, end);
		latest = countOf(page);
		return page;
	};
	const source = makePagedSource<T>({ counted: () => latest, fetch: read, pageSize: opts.size, ...(opts.markers === undefined ? {} : { markers: opts.markers }) });
	source.prime(opts.from ?? 0, opts.held.vertices);
	return source;
}
