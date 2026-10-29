/**
 * Every symbol of DL notation a graph's label draws is drawn by a font shu serves: the math font holds a glyph for each, as
 * troika's parser, which draws the labels, reads the font.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DL_SYMBOL } from "@haibun/core/lib/records/domains/axioms.js";
import { MATH_FONT_FILE } from "./bundle-file.js";
import { MATH_CODE_POINTS } from "../derivations/label-font-fallback.js";

/** troika's parser of a font and its conversion of WOFF, as its worker loads them. Its parser names the worker's global. */
async function fontParser(): Promise<(woff: Buffer) => (point: number) => boolean> {
	Object.assign(globalThis, { self: globalThis });
	const [{ default: typrFactory }, { default: woffFactory }] = await Promise.all([
		import("troika-three-text/libs/typr.factory.js"),
		import("troika-three-text/libs/woff2otf.factory.js"),
	]);
	const [typr, woff2otf] = [typrFactory(), woffFactory()];
	return (woff) => {
		const [font] = typr.parse(woff2otf(new Uint8Array(woff).buffer));
		return (point) => typr.U.codeToGlyph(font, point) > 0;
	};
}

describe("the fonts of the graph's labels", () => {
	it("draw every symbol of DL notation, which the resolver gives the math font", async () => {
		const holds = (await fontParser())(readFileSync(MATH_FONT_FILE));
		expect(MATH_CODE_POINTS, "the resolver gives the math font every DL symbol").toEqual(Object.values(DL_SYMBOL).map((symbol) => symbol.codePointAt(0)));
		expect(
			MATH_CODE_POINTS.filter((point) => !holds(point)).map((point) => String.fromCodePoint(point)),
			"the symbols the math font doesn't hold",
		).toEqual([]);
	});
});
