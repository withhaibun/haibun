import { describe, it, expect, vi } from "vitest";
import { arrayWindowedSource, lazyWindowedSource } from "./windowed-source.js";

/** A fetcher whose row value equals its absolute index, so tests can assert exact rows, with a call counter. */
function counted() {
	const fetch = vi.fn(async (start: number, end: number) => Array.from({ length: end - start }, (_, k) => start + k));
	return { fetch, calls: () => fetch.mock.calls };
}

describe("arrayWindowedSource", () => {
	it("set swaps the backing list and notifies (a live re-query)", () => {
		const src = arrayWindowedSource([1]);
		const cb = vi.fn();
		src.subscribe(cb);
		src.set([1, 2, 3]);
		expect(src.count()).toBe(3);
		expect(cb).toHaveBeenCalledOnce();
	});
});

describe("lazyWindowedSource", () => {
	it("fetches a contiguous range in one call, and never re-fetches cached pages", async () => {
		const { fetch, calls } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		await src.ensureRange(0, 10); // pages 0,1
		expect(calls()).toEqual([[0, 10]]);
		await src.ensureRange(5, 15); // page 1 cached → only page 2 fetched
		expect(calls()).toEqual([
			[0, 10],
			[10, 15],
		]);
	});

	it("coalesces concurrent requests for the same pages into a single fetch", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		await Promise.all([src.ensureRange(0, 10), src.ensureRange(0, 10), src.ensureRange(2, 8)]);
		expect(fetch).toHaveBeenCalledOnce();
		expect(src.rowAt(7)).toBe(7);
	});

	it("bounds the cached set: pages far from the last request are evicted", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 100_000, fetch, pageSize: 5, maxResidentPages: 4 });
		await src.ensureRange(0, 20); // pages 0..3
		await src.ensureRange(100, 120); // pages 20..23 → evict the far pages
		expect(src.rowAt(100)).toBe(100); // near the last request, cached
		expect(src.rowAt(0)).toBeUndefined(); // evicted
	});

	it("scales to millions: fetches only the requested window near the end", async () => {
		const { fetch, calls } = counted();
		const src = lazyWindowedSource({ count: () => 5_000_000, fetch, pageSize: 100 });
		await src.ensureRange(4_999_950, 5_000_000);
		expect(src.rowAt(4_999_999)).toBe(4_999_999);
		// one fetch for the single spanned page window, not the whole set
		expect(calls().length).toBe(1);
		expect(calls()[0][0]).toBeGreaterThan(4_000_000);
	});
});

describe("lazyWindowedSource — hardening (adversarial review)", () => {
	it("recovers from a rejected fetch: pages are re-fetchable, not bricked, and no unhandled rejection (B1)", async () => {
		let n = 0;
		const fetch = vi.fn((s: number, e: number) => (++n === 1 ? Promise.reject(new Error("net")) : Promise.resolve(Array.from({ length: e - s }, (_, k) => s + k))));
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		await src.ensureRange(0, 10); // first fetch rejects; ensureRange still resolves
		expect(src.rowAt(0)).toBeUndefined();
		await src.ensureRange(0, 10); // retries the cleared pages
		expect(src.rowAt(0)).toBe(0);
	});

	it("re-fetches a short last page when the count grows (live append) (B2)", async () => {
		let count = 450;
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => count, fetch, pageSize: 200 });
		await src.ensureRange(0, 450);
		expect(src.rowAt(449)).toBe(449);
		count = 600; // new rows appended past the old partial last page
		await src.ensureRange(400, 600);
		expect(src.rowAt(500)).toBe(500);
	});

	it("handles an over-estimated count: a capped fetch marks the data end and does not re-fetch forever (B2)", async () => {
		const fetch = vi.fn(async (s: number, e: number) => Array.from({ length: Math.max(0, Math.min(e, 950) - s) }, (_, k) => s + k));
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 200 });
		await src.ensureRange(800, 1000); // page 4 spans 800..1000 but data ends at 950
		expect(src.rowAt(949)).toBe(949);
		expect(src.rowAt(950)).toBeUndefined();
		const before = fetch.mock.calls.length;
		await src.ensureRange(800, 1000); // page 4 is now cached-to-data-end, no re-fetch
		expect(fetch.mock.calls.length).toBe(before);
	});

	it("never calls fetch with end<=start when the count shrinks below the range (B2)", async () => {
		let count = 1000;
		const fetch = vi.fn((s: number, e: number) =>
			e <= s ? Promise.reject(new Error(`fetch(${s},${e}) has end<=start`)) : Promise.resolve(Array.from({ length: e - s }, (_, k) => s + k)),
		);
		const src = lazyWindowedSource({ count: () => count, fetch, pageSize: 200 });
		count = 50;
		await src.ensureRange(700, 720); // page 3 (600..800) is beyond count 50 → no fetch, no crash
		expect(src.rowAt(700)).toBeUndefined();
	});

	it("caches a whole oversized single request cached despite the cap (B3)", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 100_000, fetch, pageSize: 5, maxResidentPages: 4 });
		await src.ensureRange(0, 40); // pages 0..7, more than the cap
		expect(src.rowAt(0)).toBe(0);
		expect(src.rowAt(39)).toBe(39);
	});

	it("a slow fetch completing after the reader scrolled away does not evict the on-screen window (B3)", async () => {
		const resolvers = new Map<number, () => void>();
		const fetch = vi.fn((s: number, e: number) => new Promise<number[]>((resolve) => resolvers.set(s, () => resolve(Array.from({ length: e - s }, (_, k) => s + k)))));
		const src = lazyWindowedSource({ count: () => 100_000, fetch, pageSize: 5, maxResidentPages: 4 });
		const slow = src.ensureRange(0, 5); // page 0 fetch deferred
		const window = src.ensureRange(100, 120); // pages 20..23 fetch deferred
		resolvers.get(100)?.(); // the on-screen window arrives first
		await window;
		resolvers.get(0)?.(); // the stale page-0 fetch completes late
		await slow;
		expect(src.rowAt(115)).toBe(115); // the live window is intact
		expect(src.rowAt(119)).toBe(119);
		expect(src.rowAt(0)).toBeUndefined(); // page 0 was the one evicted
	});

	it("notifyCountChanged notifies subscribers so a live append re-renders", () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		const cb = vi.fn();
		src.subscribe(cb);
		src.notifyCountChanged();
		expect(cb).toHaveBeenCalledOnce();
	});

	describe("append", () => {
		it("places a live row at the end of a cached page, or starts the next page, without a fetch", async () => {
			let total = 10;
			const { fetch } = counted();
			const src = lazyWindowedSource<number>({ count: () => total, fetch, pageSize: 5 });
			await src.ensureRange(5, 10); // page 1 cached: rows 5..9
			total = 11;
			src.append(10, 10); // begins page 2
			expect(src.rowAt(10), "the new row is cached at its index").toBe(10);
			total = 12;
			src.append(11, 11); // extends page 2
			expect(src.rowAt(11)).toBe(11);
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("leaves a live row whose page is not cached for ensureRange, rather than inventing a partial page", async () => {
			let total = 10;
			const { fetch } = counted();
			const src = lazyWindowedSource<number>({ count: () => total, fetch, pageSize: 5 });
			total = 13;
			src.append(12, 12); // page 2 caches nothing before it: not placed
			expect(src.rowAt(12)).toBeUndefined();
			await src.ensureRange(10, 13);
			expect(src.rowAt(12), "fetched with its page").toBe(12);
		});
	});

	describe("prime", () => {
		it("places no row at an index it is not at when the seed begins inside a page", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 100, fetch, pageSize: 10 });
			src.prime(5, [5, 6, 7]);
			expect(src.rowAt(0), "the page the seed begins inside is left to be read whole").toBeUndefined();
			expect(src.rowAt(5)).toBeUndefined();
			await src.ensureRange(0, 10);
			expect(src.rowAt(0)).toBe(0);
			expect(src.rowAt(5)).toBe(5);
		});

		it("places the pages a seed covers from their first row, and leaves the rest to be read", () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 100, fetch, pageSize: 10 });
			src.prime(5, Array.from({ length: 20 }, (_, i) => 5 + i));
			expect(src.rowAt(10)).toBe(10);
			expect(src.rowAt(20)).toBe(20);
			expect(src.rowAt(5)).toBeUndefined();
		});

		it("seeds a full first page so ensureRange over it fetches nothing", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 10_000, fetch, pageSize: 50 });
			src.prime(
				0,
				Array.from({ length: 50 }, (_, k) => k),
			);
			await src.ensureRange(0, 50);
			expect(fetch).not.toHaveBeenCalled();
			expect(src.rowAt(0)).toBe(0);
			expect(src.rowAt(49)).toBe(49);
		});

		it("still fetches windows past the seeded page", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 10_000, fetch, pageSize: 50 });
			src.prime(
				0,
				Array.from({ length: 50 }, (_, k) => k),
			);
			await src.ensureRange(50, 100);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(src.rowAt(75)).toBe(75);
		});

		it("a short seed that reaches the total counts as cached (no re-fetch of the last page)", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 30, fetch, pageSize: 50 });
			src.prime(
				0,
				Array.from({ length: 30 }, (_, k) => k),
			);
			await src.ensureRange(0, 30);
			expect(fetch).not.toHaveBeenCalled();
			expect(src.rowAt(29)).toBe(29);
			expect(src.rowAt(30)).toBeUndefined();
		});

		it("a seed shorter than the count leaves the tail to be fetched", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 200, fetch, pageSize: 50 });
			src.prime(
				0,
				Array.from({ length: 50 }, (_, k) => k),
			); // only page 0, total is 200
			await src.ensureRange(0, 50);
			expect(fetch).not.toHaveBeenCalled(); // page 0 cached
			await src.ensureRange(150, 200);
			expect(fetch).toHaveBeenCalledTimes(1); // the tail was fetched
			expect(src.rowAt(199)).toBe(199);
		});

		it("seeds a page-aligned window that is not page 0", async () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 10_000, fetch, pageSize: 50 });
			src.prime(
				100,
				Array.from({ length: 50 }, (_, k) => 100 + k),
			);
			await src.ensureRange(100, 150);
			expect(fetch).not.toHaveBeenCalled();
			expect(src.rowAt(125)).toBe(125);
			await src.ensureRange(0, 50); // page 0 was never seeded
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("notifies subscribers so the first paint renders the seed", () => {
			const { fetch } = counted();
			const src = lazyWindowedSource({ count: () => 100, fetch, pageSize: 50 });
			const cb = vi.fn();
			src.subscribe(cb);
			src.prime(0, [0, 1, 2]);
			expect(cb).toHaveBeenCalledOnce();
		});
	});
});

describe("lazyWindowedSource — the live edge under a stream", () => {
	/** A fetcher responded by hand, so a live row can arrive while its page is in flight. */
	function deferred() {
		const pending: Array<{ start: number; end: number; resolve: (rows: number[]) => void }> = [];
		const fetch = vi.fn((start: number, end: number) => new Promise<number[]>((resolve) => pending.push({ start, end, resolve })));
		const response = (rows: number[]) => pending.shift()?.resolve(rows);
		return { fetch, response, pending };
	}

	it("a live row arriving while its page is being fetched is placed when the fetch lands, and the page is whole: no second fetch", async () => {
		let total = 3;
		const { fetch, response } = deferred();
		const src = lazyWindowedSource<number>({ count: () => total, fetch, pageSize: 5 });
		const landing = src.ensureRange(0, 3); // page 0 in flight for rows 0..2
		total = 4;
		src.append(3, 3); // arrives during the fetch
		expect(src.rowAt(3), "not placed before the page it belongs to").toBeUndefined();
		response([0, 1, 2]);
		await landing;
		expect([0, 1, 2, 3].map((i) => src.rowAt(i)), "the fetched rows, then the live one").toEqual([0, 1, 2, 3]);
		await src.ensureRange(0, 4);
		expect(fetch, "the page is whole for the count: nothing to fetch again").toHaveBeenCalledTimes(1);
	});

	it("a live row the fetch already delivered is the same row once, not twice", async () => {
		let total = 3;
		const { fetch, response } = deferred();
		const src = lazyWindowedSource<number>({ count: () => total, fetch, pageSize: 5 });
		const landing = src.ensureRange(0, 3);
		total = 4;
		src.append(3, 3);
		response([0, 1, 2, 3]); // the server recorded row 3 before it responded
		await landing;
		expect(src.cachedRanges()).toEqual([{ from: 0, to: 4 }]);
		expect(src.rowAt(4)).toBeUndefined();
	});

	it("settles under a steady stream: rows arriving throughout a fetch are all placed, and the page is fetched once", async () => {
		let total = 1;
		const { fetch, response } = deferred();
		const src = lazyWindowedSource<number>({ count: () => total, fetch, pageSize: 100 });
		const landing = src.ensureRange(0, 1);
		for (let i = 1; i < 40; i++) {
			total = i + 1;
			src.append(i, i);
		}
		response([0]);
		await landing;
		for (let i = 40; i < 60; i++) {
			total = i + 1;
			src.append(i, i); // after the fetch: placed directly
		}
		await src.ensureRange(0, 60);
		expect(src.cachedRanges()).toEqual([{ from: 0, to: 60 }]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("cachedRanges joins adjacent pages and leaves a gap between separated ones", async () => {
		const fetch = vi.fn(async (s: number, e: number) => Array.from({ length: e - s }, (_, k) => s + k));
		const src = lazyWindowedSource<number>({ count: () => 100, fetch, pageSize: 10 });
		await src.ensureRange(0, 20);
		await src.ensureRange(50, 60);
		expect(src.cachedRanges()).toEqual([
			{ from: 0, to: 20 },
			{ from: 50, to: 60 },
		]);
	});
});
