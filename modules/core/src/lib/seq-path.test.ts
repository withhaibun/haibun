import { describe, it, expect } from "vitest";
import { compareSeqPath, parseSeqPath } from "./seq-path.js";

describe("parseSeqPath", () => {
	it("parses a dot-joined seqPath string back to its number tuple", () => {
		expect(parseSeqPath("0.1.2.5")).toEqual([0, 1, 2, 5]);
		expect(parseSeqPath("0.-1.5.1")).toEqual([0, -1, 5, 1]);
		expect(parseSeqPath("0")).toEqual([0]);
	});

	it("returns null for non-seqPath strings", () => {
		expect(parseSeqPath("urn:uuid:abcd")).toBeNull();
		expect(parseSeqPath("did:web:example.com")).toBeNull();
		expect(parseSeqPath("")).toBeNull();
	});
});

describe("compareSeqPath", () => {
	it("orders sibling steps numerically: 0.1 precedes 0.2", () => {
		expect(compareSeqPath([0, 1], [0, 2])).toBe(-1);
		expect(compareSeqPath([0, 2], [0, 1])).toBe(1);
	});

	it("orders parent before child: 0.1 precedes 0.1.0", () => {
		expect(compareSeqPath([0, 1], [0, 1, 0])).toBe(-1);
		expect(compareSeqPath([0, 1, 0], [0, 1])).toBe(1);
	});

	it("equal seqPaths compare equal", () => {
		expect(compareSeqPath([0, 1, 2, 5], [0, 1, 2, 5])).toBe(0);
	});

	it("treats negative segments (e.g. run-root sentinels like -1) as numerically less than positives", () => {
		expect(compareSeqPath([0, -1, 5], [0, 0, 5])).toBe(-1);
	});
});
