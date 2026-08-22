/**
 * A flow layout for lit-virtualizer that knows the size of some rows without measuring them.
 *
 * The flow layout positions the rows it has not measured by the average of the ones it has. A column whose rows
 * include many that render nothing (the run document: an event that produced no block at its level) measures ever more
 * empty rows as it goes, the average keeps falling, every position above the viewport is estimated again on each row,
 * and the reader sees the document jitter and its scroll range never settle. Here the source says which rows are known
 * empty (`rowSize` answers 0): they take no room without being measured, the average is over rows with content only,
 * and an unknown stretch is estimated at that average times the share of rows seen to have content.
 */
import { FlowLayout, flow } from "@lit-labs/virtualizer/layouts/flow.js";

/** The size of a row known without rendering it (0 for a row that renders nothing), or undefined to measure and estimate. */
export type TRowSize = (index: number) => number | undefined;

type TSizes = { [key: number]: { width: number; height: number } };
type TBounds = { pos: number; size: number };

export class KnownSizeFlowLayout extends FlowLayout {
	rowSize: TRowSize = () => undefined;
	#measured = new Map<number, number>(); // the measured size of each row whose size is not known
	#sum = 0;
	#known = new Set<number>(); // the rows seen whose size is known (rendered empty), for the share of rows with content

	override updateItemSizes(sizes: TSizes): void {
		const dim = this.direction === "horizontal" ? "width" : "height";
		for (const key of Object.keys(sizes)) {
			const idx = Number(key);
			if (this.rowSize(idx) !== undefined) {
				this.#known.add(idx);
				continue;
			}
			const size = sizes[idx][dim];
			this.#sum += size - (this.#measured.get(idx) ?? 0);
			this.#measured.set(idx, size);
		}
		super.updateItemSizes(sizes);
	}

	override _getSize(idx: number): number | undefined {
		const known = this.rowSize(idx);
		return known !== undefined ? known : super._getSize(idx);
	}

	/** The size to give a row of unknown size: the average of the measured rows with content. */
	override _getAverageSize(): number {
		return this.#measured.size > 0 ? this.#sum / this.#measured.size : super._getAverageSize();
	}

	/** What one row of a stretch not seen is worth: a row with content at the average, a known-empty one nothing, in the
	 *  proportion seen so far. */
	expectedRowSize(): number {
		const seen = this.#measured.size + this.#known.size;
		return seen === 0 ? this._getAverageSize() : (this._getAverageSize() * this.#measured.size) / seen;
	}

	override _estimatePosition(idx: number): number {
		const c = this._metricsCache;
		const per = this.expectedRowSize();
		const self = this as unknown as { _first: number; _last: number };
		if (self._first === -1 || self._last === -1) return c.averageMarginSize + idx * (c.averageMarginSize + per);
		if (idx < self._first) {
			const delta = self._first - idx;
			const ref = this._getPhysicalItem(self._first) as TBounds;
			return ref.pos - (c.getMarginSize(self._first - 1) || c.averageMarginSize) - (delta * per + (delta - 1) * c.averageMarginSize);
		}
		const delta = idx - self._last;
		const ref = this._getPhysicalItem(self._last) as TBounds;
		return ref.pos + (this._getSize(self._last) ?? this._getAverageSize()) + (c.getMarginSize(self._last) || c.averageMarginSize) + delta * (per + c.averageMarginSize);
	}
}

/** The layout for a virtual column whose source can say which rows render nothing: the flow layout's own defaults, with
 *  this class and the source's answer in place. */
export function knownSizeFlow(rowSize: TRowSize): ReturnType<typeof flow> {
	return { ...flow(), type: KnownSizeFlowLayout, rowSize } as unknown as ReturnType<typeof flow>;
}
