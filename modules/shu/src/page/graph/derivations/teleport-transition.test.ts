import { describe, expect, it } from "vitest";
import { TELEPORT_OPACITY, teleportStation } from "./teleport-transition.js";

describe("teleportStation", () => {
	const source = { x: 10, y: 20, z: 30 };
	const target = { x: 100, y: 200, z: 300 };

	it.each([
		["at its start, hidden", 0, source, 0],
		["halfway, on the line between its ends", 0.5, { x: 55, y: 110, z: 165 }, (TELEPORT_OPACITY.min + TELEPORT_OPACITY.max) / 2],
		["at its end, opaque", 1, target, TELEPORT_OPACITY.max],
	])("places a chip %s", (_, share, pos, opacity) => {
		expect(teleportStation(source, target, share)).toEqual({ pos, opacity });
	});
});
