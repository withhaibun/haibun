/**
 * The active node's glow breathes and burns through a warm colour ramp. Both are pure functions of the clock, so their
 * shape is asserted without a GPU: the breath never goes dark (the active node is always marked) and swells as it
 * brightens; the ramp cycles, wraps without a jump, and starts warm on the light theme where white would not show.
 */
import { describe, expect, it } from "vitest";
import { GLOW_RAMP, GLOW_SPREAD, PULSE_MS, glowColorAt, pulseAt, swellAt } from "./polymorphic-highlight.js";

describe("the active-node glow breathes", () => {
	it("stays lit at its dimmest, so the active node is marked at every moment of the cycle", () => {
		const over = Array.from({ length: 240 }, (_, i) => pulseAt(i * 25)); // 6s of frames: several cycles
		expect(Math.min(...over)).toBeGreaterThan(0.2);
		expect(Math.max(...over)).toBeLessThanOrEqual(1);
	});

	it("moves: a glow that sat at one intensity would not read as alive", () => {
		const over = Array.from({ length: 240 }, (_, i) => pulseAt(i * 25));
		expect(Math.max(...over) - Math.min(...over)).toBeGreaterThan(0.3);
	});

	it("repeats: the same point of a later cycle glows the same", () => {
		expect(pulseAt(1000)).toBeCloseTo(pulseAt(1000 + PULSE_MS), 6);
	});

	it("turns slowly enough to read as a breath rather than a flicker", () => {
		expect(PULSE_MS, "a cycle a person can follow, not one that catches the eye").toBeGreaterThanOrEqual(3500);
	});

	it("swells as it brightens, so the glow breathes in size as well as in light", () => {
		expect(swellAt(1)).toBeGreaterThan(swellAt(0));
		expect(swellAt(0)).toBe(1); // dimmest is the mark's own size: the glow grows outward, never shrinks inward
	});
});

describe("the glow burns through a warm ramp", () => {
	it("cycles through several colours rather than holding one", () => {
		const seen = new Set(Array.from({ length: 60 }, (_, i) => glowColorAt(pulseAt(i * 20), GLOW_RAMP.dark)));
		expect(seen.size).toBeGreaterThan(8);
	});

	it("turns with the breath, so the colour and the size are one rhythm", () => {
		const channel = (colour: string, i: number) => Number.parseInt(colour.slice(1 + i * 2, 3 + i * 2), 16);
		const samples = Array.from({ length: 40 }, (_, i) => (i * PULSE_MS) / 40).map((ms) => ({ light: pulseAt(ms), red: channel(glowColorAt(pulseAt(ms), GLOW_RAMP.dark), 0) }));
		const dimmest = samples.reduce((low, s) => (s.light < low.light ? s : low));
		const fullest = samples.reduce((high, s) => (s.light > high.light ? s : high));
		expect(channel(glowColorAt(pulseAt(0), GLOW_RAMP.dark), 2), "the dim end of the ramp is its warmest").toBeLessThan(255);
		expect(dimmest.red, "both ends are lit, whatever the hue").toBeGreaterThan(100);
		expect(fullest.red).toBeGreaterThan(100);
	});

	it("steps by no more than a shade between the frames it is drawn on, so it never cuts", () => {
		const channels = (colour: string) => [0, 1, 2].map((i) => Number.parseInt(colour.slice(1 + i * 2, 3 + i * 2), 16));
		const FRAME_MS = 100; // the highlight is redrawn a few times a second, not every frame
		let widest = 0;
		for (let ms = 0; ms < PULSE_MS * 2; ms += FRAME_MS) {
			const [a, b] = [channels(glowColorAt(pulseAt(ms), GLOW_RAMP.dark)), channels(glowColorAt(pulseAt(ms + FRAME_MS), GLOW_RAMP.dark))];
			widest = Math.max(widest, ...a.map((v, i) => Math.abs(v - b[i])));
		}
		expect(widest, "a jump between drawn frames is what reads as flicker").toBeLessThan(30);
	});

	it("every colour it produces is a colour", () => {
		for (const ms of [0, 137, 400, 900, 3000]) expect(glowColorAt(pulseAt(ms), GLOW_RAMP.light)).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("the light theme starts warm, never white, white on a white page is nothing to see", () => {
		expect(GLOW_RAMP.light).not.toContain("#ffffff");
		expect(GLOW_RAMP.dark[0]).toBe("#ffffff");
	});
});

describe("the glow rings a mark evenly, whatever shape the mark is", () => {
	/** The sprite sizer, as spriteVisual runs it: the glow is a CHILD, so its local scale divides out the parent's. */
	const haloAround = (sx: number, sy: number, swell: number) => {
		const reach = Math.min(sx, sy) * GLOW_SPREAD * swell;
		const local = { x: (sx + 2 * reach) / sx, y: (sy + 2 * reach) / sy };
		return { thicknessX: ((local.x - 1) * sx) / 2, thicknessY: ((local.y - 1) * sy) / 2 };
	};

	it("is the same thickness on every side of an upright mark", () => {
		const tall = haloAround(0.4, 3, 1);
		expect(tall.thicknessX).toBeCloseTo(tall.thicknessY, 6);
	});

	it("is the same thickness on every side of a wide mark too, and grows with the breath", () => {
		const wide = haloAround(4, 0.5, 1);
		expect(wide.thicknessX).toBeCloseTo(wide.thicknessY, 6);
		expect(haloAround(4, 0.5, 1).thicknessX, "the breath swells the reach").toBeGreaterThan(haloAround(4, 0.5, 0.5).thicknessX);
	});
});
