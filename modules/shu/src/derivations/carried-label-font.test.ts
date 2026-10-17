import { describe, expect, it } from "vitest";
import { UNCOVERED_FLAGS, carriedLabelFont, codePointRanges, coveredText } from "./carried-label-font.js";

/** Four bytes of a WOFF's signature, as the label font starts. */
const WOFF_SIGNATURE = new Uint8Array([0x77, 0x4f, 0x46, 0x46]).buffer;

describe("the font a report carries for its labels", () => {
	it("reads each range of a unicode-range, a single code point as a range of one", () => {
		expect(codePointRanges("U+0000-00FF, U+0131,U+FFFD")).toEqual([
			[0, 0xff],
			[0x131, 0x131],
			[0xfffd, 0xfffd],
		]);
	});

	it("refuses a range that isn't U+ and a code point", () => {
		expect(() => codePointRanges("U+0000-00FF,latin")).toThrow(/"latin" in the label font's unicode-range/);
	});

	it("carries the font as a WOFF data URL", () => {
		expect(carriedLabelFont(WOFF_SIGNATURE, "U+0041").font).toBe("data:font/woff;base64,d09GRg==");
	});

	it("replaces each character outside the ranges, a character beyond the first plane included, and keeps the rest", () => {
		const { uncovered } = carriedLabelFont(WOFF_SIGNATURE, "U+0000-00FF,U+0131,U+FFFD");
		expect(coveredText("Zoë ı → 東京 😀", new RegExp(uncovered, UNCOVERED_FLAGS))).toBe("Zoë ı � �� �");
	});
});
