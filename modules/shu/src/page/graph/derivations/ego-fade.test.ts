import { describe, expect, it } from "vitest";
import { EGO_FADE_MS, EGO_HIDDEN, fadeEnded, fadeOpacity, fadeToward, type TEgoFade } from "./ego-fade.js";

const SHOWING: TEgoFade = fadeToward(EGO_HIDDEN, 1, 0);
const HALF_OUT = EGO_FADE_MS.out / 2;
const fadingOut = fadeToward({ from: 0, to: 1, at: -EGO_FADE_MS.in }, 0, 0);

describe("the ego overlay's fade", () => {
	it.each([
		["a hidden overlay", EGO_HIDDEN, 0, 0, true],
		["a fade-in as it starts", SHOWING, 0, 0, false],
		["a fade-in halfway", SHOWING, EGO_FADE_MS.in / 2, 0.5, false],
		["a fade-in at its end", SHOWING, EGO_FADE_MS.in, 1, true],
		["a fade-out halfway", fadingOut, HALF_OUT, 0.5, false],
		["a fade-out at its end", fadingOut, EGO_FADE_MS.out, 0, true],
	])("holds the opacity of %s", (_, fade, now, opacity, ended) => {
		expect(fadeOpacity(fade, now)).toBeCloseTo(opacity);
		expect(fadeEnded(fade, now)).toBe(ended);
	});

	it("reverses a fade-out from the opacity it holds when a hover returns", () => {
		const reversed = fadeToward(fadingOut, 1, HALF_OUT);
		expect(reversed).toEqual({ from: fadeOpacity(fadingOut, HALF_OUT), to: 1, at: HALF_OUT });
		expect(fadeOpacity(reversed, HALF_OUT)).toBeCloseTo(0.5);
	});

	it("keeps a fade that already moves toward the end the call names", () => {
		expect(fadeToward(SHOWING, 1, 100)).toBe(SHOWING);
	});
});
