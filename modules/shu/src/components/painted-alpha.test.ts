/**
 * What a browser says a painted colour's alpha is. It writes one in two shapes, and a mixed colour comes back in the
 * one a plain rgba parse misses — which read as opaque, and failed a translucent guide for being translucent.
 */
import { describe, expect, it } from "vitest";
import { paintedAlpha } from "./shu-polymorphic-graph-view.controls.js";

describe("the alpha of a painted colour", () => {
	it("reads both shapes a browser writes, and treats an unstated alpha as opaque", () => {
		expect(paintedAlpha("color(srgb 0.956863 0.956863 0.956863 / 0.82)"), "what a color-mix comes back as").toBeCloseTo(0.82);
		expect(paintedAlpha("rgba(0, 0, 0, 0.5)"), "and the older shape").toBe(0.5);
		expect(paintedAlpha("rgb(20, 20, 20)"), "no alpha stated is opaque").toBe(1);
		expect(paintedAlpha("color(srgb 0.1 0.1 0.1)"), "either way round").toBe(1);
		expect(paintedAlpha("color(srgb 0.1 0.1 0.1 / 50%)"), "an alpha written as a percentage is the same alpha").toBe(0.5);
	});
});
