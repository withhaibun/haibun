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
