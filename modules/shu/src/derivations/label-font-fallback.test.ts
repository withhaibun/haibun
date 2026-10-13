import { describe, expect, it } from "vitest";
import { labelFontFallback } from "./label-font-fallback.js";

describe("labelFontFallback", () => {
	it("returns an empty coverage for every code point index, which the resolver reads as the fallback font", () => {
		expect(labelFontFallback("codepoint-index/plane0/2200-22ff.json")).toEqual({ kind: "json", body: [1, {}] });
	});
	it("names the fallback font's one typeform, and serves the label font as its file", () => {
		expect(labelFontFallback("font-meta/latin.json")).toEqual({ kind: "json", body: [1, { id: "latin", typeforms: { "sans-serif": { normal: [400] } }, ranges: "" }] });
		expect(labelFontFallback("font-files/latin/sans-serif.normal.400.woff")).toEqual({ kind: "font" });
	});
	it("returns undefined for a path the resolver doesn't request", () => {
		expect(labelFontFallback("font-meta/other.json")).toBeUndefined();
		expect(labelFontFallback("../ns/context.jsonld")).toBeUndefined();
	});
});
