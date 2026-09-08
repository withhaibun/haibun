/**
 * One specification, every windowed source. A column renders rows by index and does not know what is under it: a list
 * already in memory, pages fetched as a reader reaches them, or the window of a run over the records it wrote. A
 * difference between them is a difference in what a reader sees, so each answers these cases rather than carrying a
 * suite of its own.
 *
 * What is specified is the reading: how many rows there are, what the row at an index is, what a range that has been
 * read holds, and what arrives at a subscriber. How a source gets its rows is its own, and each states that where it
 * is implemented: eviction and coalescing for the paged one, currency and levels for the run's.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { WindowedSource } from "../windowed-source.js";

/** A source ready to read, over a known number of rows. `named` names a row the source answers, and `shouldName` is
 *  what the row at an index is called, so a case says which row it read rather than that it read something. */
export type TSourceUnderTest<T> = {
	source: WindowedSource<T>;
	named(row: T): string;
	shouldName(index: number): string;
	done?(): void | Promise<void>;
};

/** What a source says of itself, where sources differ by design rather than by defect. */
export type TSourceNature = {
	/** True for a source that fetches rows as they are read. A source whose rows are all in memory delivers nothing,
	 *  so it announces nothing. */
	pages?: boolean;
};

/** How many rows the cases read over, and where in them the middle window falls: enough rows that a paged source spans
 *  several pages, so reading a window in the middle is a read of pages the start does not cover. */
export const CONFORMANCE_ROWS = 25;
const MIDDLE = 10;
const WINDOW = 5;

/**
 * Run the specification against one source. `make` returns a source over `CONFORMANCE_ROWS` rows, ready to read, and
 * `done` releases what it holds.
 */
export function describeWindowedSource<T>(name: string, make: () => TSourceUnderTest<T> | Promise<TSourceUnderTest<T>>, nature: TSourceNature = {}): void {
	describe(`the windowed source (${name})`, () => {
		let held: TSourceUnderTest<T>;
		let source: WindowedSource<T>;
		const nameAt = (index: number): string | undefined => {
			const row = source.rowAt(index);
			return row === undefined ? undefined : held.named(row);
		};
		beforeEach(async () => {
			held = await make();
			source = held.source;
			return async () => {
				await held.done?.();
			};
		});

		it("says how many rows it has", () => {
			expect(source.count()).toBe(CONFORMANCE_ROWS);
		});

		it("answers every row of a range that has been read, in the order the rows are in", async () => {
			await source.ensureRange(0, source.count());
			for (let i = 0; i < CONFORMANCE_ROWS; i++) expect(nameAt(i)).toBe(held.shouldName(i));
		});

		it("reads a window in the middle without reading what comes before it", async () => {
			await source.ensureRange(MIDDLE, MIDDLE + WINDOW);
			for (let i = MIDDLE; i < MIDDLE + WINDOW; i++) expect(nameAt(i)).toBe(held.shouldName(i));
		});

		it("answers nothing for an index outside the rows it has", async () => {
			await source.ensureRange(0, source.count());
			expect(source.rowAt(-1)).toBeUndefined();
			expect(source.rowAt(CONFORMANCE_ROWS)).toBeUndefined();
			expect(source.rowAt(CONFORMANCE_ROWS + WINDOW)).toBeUndefined();
		});

		it("reads nothing for a range that asks for nothing", async () => {
			await source.ensureRange(MIDDLE, MIDDLE);
			expect(source.count()).toBe(CONFORMANCE_ROWS);
		});

		it("reads a range that runs past the end, and answers the rows within it", async () => {
			await source.ensureRange(CONFORMANCE_ROWS - 2, CONFORMANCE_ROWS + 50);
			expect(nameAt(CONFORMANCE_ROWS - 1)).toBe(held.shouldName(CONFORMANCE_ROWS - 1));
			expect(source.rowAt(CONFORMANCE_ROWS)).toBeUndefined();
		});

		it("gives back the same row when a range is read again, so a view keeps its place and what it built from a row", async () => {
			await source.ensureRange(MIDDLE, MIDDLE + WINDOW);
			const first = source.rowAt(MIDDLE);
			await source.ensureRange(MIDDLE, MIDDLE + WINDOW);
			expect(source.rowAt(MIDDLE)).toBe(first);
		});

		it("marks rows it has, and none it does not", () => {
			for (const mark of source.markers()) {
				expect(mark.index).toBeGreaterThanOrEqual(0);
				expect(mark.index).toBeLessThan(source.count());
			}
		});

		it("stops telling a subscriber that has been dropped", async () => {
			let told = 0;
			const stop = source.subscribe(() => told++);
			stop();
			await source.ensureRange(MIDDLE, MIDDLE + WINDOW);
			expect(told).toBe(0);
		});

		if (nature.pages === true) {
			it("answers nothing for a row it has not read, so a column gives that row its place rather than a row it does not have", () => {
				expect(source.rowAt(MIDDLE)).toBeUndefined();
			});

			it("tells a subscriber when the rows it fetched arrive", async () => {
				let told = 0;
				const stop = source.subscribe(() => told++);
				await source.ensureRange(MIDDLE, MIDDLE + WINDOW);
				expect(told).toBeGreaterThan(0);
				stop();
			});
		}
	});
}
