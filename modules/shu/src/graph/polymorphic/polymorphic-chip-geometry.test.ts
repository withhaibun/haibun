/**
 * The chip's quads are just numbers, so the layout is pinned here rather than against a GPU: that the avatar badge sits
 * inside the chip, that the label clears it, and that adding a badge does not move the node's point off the chip.
 */
import { describe, expect, it } from "vitest";
import { avatarLeadX, chipGeometry } from "./polymorphic-troika-label.js";

const FONT = 10;
/** A measured label, as troika reports it: anchorX left / anchorY top, so it starts at the origin and flows right + down. */
const LABEL: [number, number, number, number] = [0, -FONT, 60, 0];

describe("chipGeometry", () => {
	it("puts the node's point at the chip's top-left, a hair inside it so the exact point is pickable", () => {
		for (const leadX of [0, avatarLeadX(12, FONT)]) {
			const g = chipGeometry(LABEL, leadX, FONT);
			const left = g.cx - g.w / 2;
			const top = g.cy + g.h / 2;
			expect(left).toBeLessThan(0); // the point is inside the quad, not on its corner
			expect(top).toBeGreaterThan(0);
			expect(left).toBeGreaterThan(-FONT * 0.5); // ... by a hair, so the chip does not straddle the point
			expect(top).toBeLessThan(FONT * 0.5);
		}
	});

	it("widens the chip by exactly the avatar's lead, leaving its height and the label's own padding alone", () => {
		const plain = chipGeometry(LABEL, 0, FONT);
		const leadX = avatarLeadX(12, FONT);
		const badged = chipGeometry(LABEL, leadX, FONT);
		expect(badged.w - plain.w).toBeCloseTo(leadX);
		expect(badged.h).toBe(plain.h);
	});

	it("spans the badge from the chip's left edge to the gap before the label, never past it", () => {
		const leadX = avatarLeadX(12, FONT);
		const g = chipGeometry(LABEL, leadX, FONT);
		const badge = g.badge;
		if (!badge) throw new Error("a chip built with an avatar lead has a badge");
		const badgeLeft = badge.cx - badge.w / 2;
		const badgeRight = badge.cx + badge.w / 2;
		expect(badgeLeft).toBeCloseTo(g.cx - g.w / 2); // flush with the chip's leading edge — no sliver of body before it
		expect(badgeRight).toBeLessThan(leadX); // stops short of where the label starts
		expect(badgeRight).toBeGreaterThan(0);
	});

	it("has no badge when the chip carries no avatar", () => {
		expect(chipGeometry(LABEL, 0, FONT).badge).toBeUndefined();
	});

	it("grows the badge with the initials, so SR takes more room than P", () => {
		const one = chipGeometry(LABEL, avatarLeadX(6, FONT), FONT);
		const two = chipGeometry(LABEL, avatarLeadX(14, FONT), FONT);
		expect(two.badge?.w ?? 0).toBeGreaterThan(one.badge?.w ?? 0);
		expect(two.w).toBeGreaterThan(one.w);
	});

	it("draws an edge just past the background on every side, so a pale chip has a shape on a light page", () => {
		const g = chipGeometry(LABEL, avatarLeadX(12, FONT), FONT);
		expect(g.border.w).toBeGreaterThan(g.w);
		expect(g.border.h).toBeGreaterThan(g.h);
		expect(g.border.w - g.w, "a hairline, not a frame").toBeLessThan(FONT * 0.2);
	});

	it("reaches the active glow past the chip on every side, by the chip's HEIGHT — so a long label glows as thickly as a short one", () => {
		const short = chipGeometry([0, -8, 20, 0], 0, FONT);
		const long = chipGeometry([0, -8, 200, 0], 0, FONT);
		expect(short.glow.w).toBeGreaterThan(short.w);
		expect(short.glow.h).toBeGreaterThan(short.h);
		expect(long.glow.w - long.w).toBeCloseTo(short.glow.w - short.w, 6); // the reach is the same on both, though one chip is ten times wider
	});
});
