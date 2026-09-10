/**
 * The paging core under arbitrary interleaving. The defects this source has had were orderings, not cases: a live row
 * arriving while its page was being fetched, a page fetched again because a live row landed short of it, a cached range
 * disagreeing with what the rows read. Enumerated tests cover the orderings someone thought of; this drives thousands of
 * random sequences of ensureRange, append, count growth and out-of-order fetch completion against a reference model, and
 * asserts the invariants that must hold after every operation. Seeded, so a failure replays exactly.
 */
import { describe, it, expect } from "vitest";
import { lazyWindowedSource } from "./windowed-source.js";

/** A row's value is its index, so a wrong row is detectable by inspection. */
const rowFor = (index: number): number => index;

/** Deterministic pseudo-random numbers: a seed replays a failing sequence exactly. */
function seeded(seed: number): () => number {
	let t = seed + 0x6d2b79f5;
	return () => {
		t = Math.imul(t ^ (t >>> 15), 1 | t);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type TPending = { start: number; end: number; resolve: () => void };

/** A source whose fetches complete when this harness says so, over data of a known extent. */
function harness(opts: { pageSize: number; maxResidentPages?: number; dataEnd: number }) {
	const pending: TPending[] = [];
	const fetches: Array<[number, number]> = [];
	let total = 0;
	const src = lazyWindowedSource<number>({
		count: () => total,
		pageSize: opts.pageSize,
		maxResidentPages: opts.maxResidentPages,
		fetch: (start, end) => {
			fetches.push([start, end]);
			return new Promise<readonly number[]>((res) => {
				pending.push({ start, end, resolve: () => res(Array.from({ length: Math.max(0, Math.min(end, opts.dataEnd) - start) }, (_, k) => rowFor(start + k))) });
			});
		},
	});
	return {
		src,
		fetches,
		pending,
		get total() {
			return total;
		},
		grow(by: number) {
			total = Math.min(opts.dataEnd, total + by);
		},
		setTotal(n: number) {
			total = n;
		},
		/** Complete one outstanding fetch, chosen by index, so completions can land out of order. */
		complete(which: number): void {
			const [p] = pending.splice(which % Math.max(1, pending.length), 1);
			p?.resolve();
		},
		/** Complete every outstanding fetch, and the fetches those completions start, until none remain. */
		async drain(): Promise<void> {
			for (let pass = 0; pass < 200; pass++) {
				while (pending.length > 0) this.complete(0);
				await new Promise((r) => setTimeout(r, 0));
				if (pending.length === 0) return;
			}
			throw new Error("drain: fetches never stopped");
		},
	};
}

/** Every row read is the row that belongs at that index, and the cached ranges name exactly the indices that read. */
function assertInvariants(h: ReturnType<typeof harness>, note: string): void {
	const src = h.src;
	const readable: number[] = [];
	for (let i = 0; i < h.total; i++) {
		const row = src.rowAt(i);
		if (row === undefined) continue;
		expect(row, `${note}: row ${i} read as ${row}`).toBe(rowFor(i));
		readable.push(i);
	}
	const named: number[] = [];
	for (const { from, to } of src.cachedRanges()) {
		expect(to, `${note}: range ${from}..${to} is empty or inverted`).toBeGreaterThan(from);
		for (let i = from; i < to; i++) if (i < h.total) named.push(i);
	}
	expect(
		named.sort((a, b) => a - b),
		`${note}: cachedRanges disagrees with the rows that read`,
	).toEqual(readable);
	for (const [start, end] of h.fetches) expect(end, `${note}: fetch(${start}, ${end}) has end<=start`).toBeGreaterThan(start);
}

describe("the paging core under arbitrary interleaving", () => {
	it("reads only true rows and names exactly what it caches, however operations interleave", async () => {
		for (let seed = 1; seed <= 60; seed++) {
			const random = seeded(seed);
			const pageSize = 1 + Math.floor(random() * 8);
			const h = harness({ pageSize, maxResidentPages: 4 + Math.floor(random() * 6), dataEnd: 40 + Math.floor(random() * 60) });
			h.grow(1 + Math.floor(random() * 20));
			const waits: Promise<void>[] = [];
			for (let step = 0; step < 40; step++) {
				const roll = random();
				if (roll < 0.4) {
					const start = Math.floor(random() * Math.max(1, h.total));
					waits.push(h.src.ensureRange(start, start + 1 + Math.floor(random() * pageSize * 2)));
				} else if (roll < 0.6 && h.pending.length > 0) h.complete(Math.floor(random() * h.pending.length));
				else if (roll < 0.85) {
					const before = h.total;
					h.grow(1 + Math.floor(random() * 3));
					for (let i = before; i < h.total; i++) h.src.append(i, rowFor(i));
				} else h.src.notifyCountChanged();
				assertInvariants(h, `seed ${seed} step ${step}`);
			}
			await h.drain();
			await Promise.all(waits);
			assertInvariants(h, `seed ${seed} drained`);
		}
	});

	it("converges: after any interleaving, one request over a window caches all of it, and no page is fetched twice", async () => {
		for (let seed = 1; seed <= 40; seed++) {
			const random = seeded(seed * 7);
			const pageSize = 2 + Math.floor(random() * 6);
			const dataEnd = 60 + Math.floor(random() * 40);
			// A cap larger than the data: eviction never runs, so a second fetch of a page could only be a re-fetch.
			const h = harness({ pageSize, maxResidentPages: 1000, dataEnd });
			h.grow(dataEnd);
			const waits: Promise<void>[] = [];
			for (let step = 0; step < 25; step++) {
				const roll = random();
				if (roll < 0.5) {
					const start = Math.floor(random() * dataEnd);
					waits.push(h.src.ensureRange(start, start + 1 + Math.floor(random() * pageSize * 3)));
				} else if (h.pending.length > 0) h.complete(Math.floor(random() * h.pending.length));
			}
			await h.drain();
			await Promise.all(waits);
			const whole = h.src.ensureRange(0, dataEnd); // started before the fetches it needs are completed
			await h.drain();
			await whole;
			for (let i = 0; i < dataEnd; i++) expect(h.src.rowAt(i), `seed ${seed}: row ${i} after requesting the whole run`).toBe(rowFor(i));
			expect(h.src.cachedRanges(), `seed ${seed}: one range over the whole run`).toEqual([{ from: 0, to: dataEnd }]);
			const fetchedPages = h.fetches.flatMap(([start, end]) => Array.from({ length: Math.ceil((end - start) / pageSize) }, (_, k) => Math.floor(start / pageSize) + k));
			expect(new Set(fetchedPages).size, `seed ${seed}: pages fetched once each`).toBe(fetchedPages.length);
		}
	});

	it("under a steady stream of live rows through in-flight fetches, every row is placed and each page is fetched once", async () => {
		for (let seed = 1; seed <= 30; seed++) {
			const random = seeded(seed * 13);
			const pageSize = 3 + Math.floor(random() * 10);
			const h = harness({ pageSize, maxResidentPages: 1000, dataEnd: 500 });
			h.grow(1);
			const waits: Promise<void>[] = [h.src.ensureRange(0, 1)];
			for (let step = 0; step < 60; step++) {
				if (random() < 0.25 && h.pending.length > 0) h.complete(0);
				const before = h.total;
				h.grow(1 + Math.floor(random() * 4));
				for (let i = before; i < h.total; i++) h.src.append(i, rowFor(i));
				if (random() < 0.3) waits.push(h.src.ensureRange(Math.max(0, h.total - pageSize), h.total));
			}
			await h.drain();
			await Promise.all(waits);
			const final = h.total;
			const whole = h.src.ensureRange(0, final);
			await h.drain();
			await whole;
			expect(h.src.cachedRanges(), `seed ${seed}: the whole stream cached`).toEqual([{ from: 0, to: final }]);
			const fetchedPages = h.fetches.flatMap(([start, end]) => Array.from({ length: Math.ceil((end - start) / pageSize) }, (_, k) => Math.floor(start / pageSize) + k));
			expect(new Set(fetchedPages).size, `seed ${seed}: no page fetched twice under the stream`).toBe(fetchedPages.length);
		}
	});
});
