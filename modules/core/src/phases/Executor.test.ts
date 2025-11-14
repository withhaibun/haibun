import { describe, expect, it } from "vitest";

import { TSeqPath } from "../lib/defs";
import { incSeqPath } from "./Executor";

describe('incSeqPath', () => {
	it('increments single depth seqPath', () => {
		const original: TSeqPath = [1];
		const withSeqPath = [
			{ seqPath: [1] },
			{ seqPath: [2] },
		];
		const incremented = incSeqPath(withSeqPath, original);
		expect(incremented).toEqual([3]);
	});
	it('increments multiple depth seqPath', () => {
		const original: TSeqPath = [1, 2, 3];
		const withSeqPath = [
			{ seqPath: [1, 2, 3] },
		];
		const incremented = incSeqPath(withSeqPath, original);
		expect(incremented).toEqual([1, 2, 4]);
	});
});

describe('decSeqPath', () => {
	it('decrements single depth seqPath', () => {
		const original: TSeqPath = [1];
		const withSeqPath = [
			{ seqPath: [1] },
			{ seqPath: [2] },
		];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([-1]);
	});
	it('decrements single depth seqPath', () => {
		const original: TSeqPath = [1];
		const withSeqPath = [
			{ seqPath: [-1] },
			{ seqPath: [2] },
		];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([-2]);
	});
	it('decrements multiple depth seqPath', () => {
		const original: TSeqPath = [1, 2, 3];
		const withSeqPath = [
			{ seqPath: [1, 2, 3] },
		];
		const incremented = incSeqPath(withSeqPath, original, -1);
		expect(incremented).toEqual([1, 2, -1]);
	});
});
