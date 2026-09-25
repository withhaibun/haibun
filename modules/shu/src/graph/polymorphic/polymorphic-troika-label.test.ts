import { describe, expect, it, vi } from "vitest";

/** The measurements asked of troika's worker, landed by the test in the order it chooses. */
const landings: (() => void)[] = [];
vi.mock("troika-three-text", () => ({
	Text: class {
		material = {};
		position = { x: 0 };
		textRenderInfo = { blockBounds: [0, -1, 4, 0] };
		sync(landed: () => void) {
			landings.push(landed);
		}
	},
}));

import { makeTroikaChip, type ChipThree } from "./polymorphic-troika-label.js";

/** A scene object as the chip builds one; a constructor returning an object makes `new` return it. */
function part() {
	return { renderOrder: 0, scale: { set: () => undefined }, position: { x: 0, set: () => undefined }, add: () => undefined };
}
function material() {
	return { opacity: 1, transparent: true };
}
const three = { Group: part, Mesh: part, PlaneGeometry: part, MeshBasicMaterial: material } as unknown as ChipThree;
const deps = { fontSize: 1, renderOrder: 0, textColor: "#000", borderColor: "#000", highlightColor: "#fc0" };

describe("a chip's measured text", () => {
	it("is laying out until its label and its badge have both landed, and each landing asks for a frame", () => {
		const laidOut = vi.fn();
		const chip = makeTroikaChip("label", "#fff", three, { ...deps, avatar: "AB", laidOut });
		expect(landings, "the badge and the label are measured").toHaveLength(2);
		expect(chip.layingOut).toBe(true);
		landings.shift()?.();
		expect(chip.layingOut, "the label is still to land").toBe(true);
		landings.shift()?.();
		expect(chip.layingOut).toBe(false);
		expect(laidOut).toHaveBeenCalledTimes(2);
	});

	it("without a badge, is laid out once its label lands", () => {
		const chip = makeTroikaChip("label", "#fff", three, { ...deps, laidOut: () => undefined });
		expect(chip.layingOut).toBe(true);
		landings.shift()?.();
		expect(chip.layingOut).toBe(false);
	});
});
