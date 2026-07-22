import { describe, it, expect, vi } from "vitest";
import { arrayWindowedSource, lazyWindowedSource } from "./windowed-source.js";

/** A fetcher whose row value equals its absolute index, so tests can assert exact rows, with a call counter. */
function counted() {
	const fetch = vi.fn(async (start: number, end: number) => Array.from({ length: end - start }, (_, k) => start + k));
	return { fetch, calls: () => fetch.mock.calls };
}

describe("arrayWindowedSource", () => {
	it("serves every resident row and no-ops ensureRange", async () => {
		const src = arrayWindowedSource([10, 20, 30]);
		expect(src.count()).toBe(3);
		expect(src.rowAt(1)).toBe(20);
		await expect(src.ensureRange(0, 3)).resolves.toBeUndefined();
	});
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
	it("is empty until ensureRange, then serves the fetched window", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		expect(src.rowAt(0)).toBeUndefined();
		await src.ensureRange(0, 10);
		expect(src.rowAt(0)).toBe(0);
		expect(src.rowAt(9)).toBe(9);
	});

	it("fetches a contiguous range in one call, and never re-fetches resident pages", async () => {
		const { fetch, calls } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		await src.ensureRange(0, 10); // pages 0,1
		expect(calls()).toEqual([[0, 10]]);
		await src.ensureRange(5, 15); // page 1 resident → only page 2 fetched
		expect(calls()).toEqual([[0, 10], [10, 15]]);
	});

	it("coalesces concurrent requests for the same pages into a single fetch", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		await Promise.all([src.ensureRange(0, 10), src.ensureRange(0, 10), src.ensureRange(2, 8)]);
		expect(fetch).toHaveBeenCalledOnce();
		expect(src.rowAt(7)).toBe(7);
	});

	it("bounds the resident set: pages far from the last request are evicted", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 100_000, fetch, pageSize: 5, maxResidentPages: 4 });
		await src.ensureRange(0, 20); // pages 0..3
		await src.ensureRange(100, 120); // pages 20..23 → evict the far pages
		expect(src.rowAt(100)).toBe(100); // near the last request, resident
		expect(src.rowAt(0)).toBeUndefined(); // evicted
	});

	it("notifies subscribers when a fetched range arrives", async () => {
		const { fetch } = counted();
		const src = lazyWindowedSource({ count: () => 1000, fetch, pageSize: 5 });
		const cb = vi.fn();
		src.subscribe(cb);
		await src.ensureRange(0, 10);
		expect(cb).toHaveBeenCalled();
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
		await src.ensureRange(800, 1000); // page 4 is now resident-to-data-end, no re-fetch
		expect(fetch.mock.calls.length).toBe(before);
	});

	it("never calls fetch with end<=start when the count shrinks below the range (B2)", async () => {
		let count = 1000;
		const fetch = vi.fn((s: number, e: number) => (e <= s ? Promise.reject(new Error(`fetch(${s},${e}) has end<=start`)) : Promise.resolve(Array.from({ length: e - s }, (_, k) => s + k))));
		const src = lazyWindowedSource({ count: () => count, fetch, pageSize: 200 });
		count = 50;
		await src.ensureRange(700, 720); // page 3 (600..800) is beyond count 50 → no fetch, no crash
		expect(src.rowAt(700)).toBeUndefined();
	});

	it("keeps a whole oversized single request resident despite the cap (B3)", async () => {
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
});
