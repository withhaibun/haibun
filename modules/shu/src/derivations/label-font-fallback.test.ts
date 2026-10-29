import { describe, expect, it } from "vitest";
import { FALLBACK_FONT, MATH_CODE_POINTS, labelFontFallback } from "./label-font-fallback.js";

/** Whether a resolver's coverage names `point`, as troika's resolver reads it: a character for each six code points of the
 *  index, above "0", each bit a code point. */
const covers = (coverage: string, point: number): boolean => {
	const offset = point & 0xff;
	const cell = coverage.codePointAt(Math.floor(offset / 6));
	return cell !== undefined && ((cell - 48) & (1 << (offset % 6))) !== 0;
};

describe("labelFontFallback", () => {
	it("names the math font for each symbol of DL notation in the index that holds it, and leaves the index's other code points uncovered", () => {
		const answer = labelFontFallback("codepoint-index/plane0/2200-22ff.json");
		if (answer?.kind !== "json") throw new Error("the resolver doesn't return the index of the mathematical operators");
		const [, languages] = answer.body as [number, Record<string, Record<string, string>>];
		const coverage = languages[""]?.[FALLBACK_FONT.math];
		if (coverage === undefined) throw new Error("the index doesn't name the math font");
		expect(MATH_CODE_POINTS.every((point) => covers(coverage, point))).toBe(true);
		expect(covers(coverage, 0x2260), "≠ isn't a symbol the axioms write").toBe(false);
	});
	it("returns an empty coverage for an index without a DL symbol, which the resolver reads as the label font", () => {
		expect(labelFontFallback("codepoint-index/plane0/0-ff.json")).toEqual({ kind: "json", body: [1, {}] });
	});
	it("names each fallback font's one typeform, the math font with the symbols it covers, and serves each font's file", () => {
		expect(labelFontFallback("font-meta/latin.json")).toEqual({ kind: "json", body: [1, { id: "latin", typeforms: { "sans-serif": { normal: [400] } }, ranges: "" }] });
		expect(labelFontFallback("font-meta/math.json")).toMatchObject({ kind: "json", body: [1, { id: "math", ranges: expect.stringContaining("U+2291") }] });
		expect(labelFontFallback("font-files/latin/sans-serif.normal.400.woff")).toEqual({ kind: "font", font: FALLBACK_FONT.label });
		expect(labelFontFallback("font-files/math/sans-serif.normal.400.woff")).toEqual({ kind: "font", font: FALLBACK_FONT.math });
	});
	it("returns undefined for a path the resolver doesn't request", () => {
		expect(labelFontFallback("font-meta/other.json")).toBeUndefined();
		expect(labelFontFallback("font-files/math/serif.normal.400.woff")).toBeUndefined();
		expect(labelFontFallback("../ns/context.jsonld")).toBeUndefined();
	});
});
