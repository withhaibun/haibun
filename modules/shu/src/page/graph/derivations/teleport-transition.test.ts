import { describe, expect, it } from "vitest";
import { teleportStation } from "./teleport-transition.js";
import type { XYZ } from "../domains/graph-types.js";

describe("teleportStation", () => {
	const source: XYZ = { x: 10, y: 20, z: 30 };
	const target: XYZ = { x: 100, y: 200, z: 300 };

	it("returns target position and full opacity at progress 1", () => {
		const station = teleportStation(source, target, 1.0);
		expect(station.pos).toEqual(target);
		expect(station.opacity).toBe(1.0);
		expect(station.spokeProgress).toBe(1.0);
	});

	it("returns source position and zero opacity at progress 0", () => {
		const station = teleportStation(source, target, 0.0);
		expect(station.pos).toEqual(source);
		expect(station.opacity).toBe(0);
		expect(station.spokeProgress).toBe(0);
	});

	it("smoothly interpolates intermediate progress with ease-out cubic", () => {
		const s = teleportStation(source, target, 0.5);
		// At progress 0.5, easeOut is 1 - 0.5^3 = 0.875
		expect(s.pos.x).toBeCloseTo(10 + 0.875 * 90);
		expect(s.pos.y).toBeCloseTo(20 + 0.875 * 180);
		expect(s.pos.z).toBeCloseTo(30 + 0.875 * 270);
		expect(s.opacity).toBeGreaterThan(0.8);
	});

	it("quantizes intermediate progress when staccato is specified", () => {
		// Progress 0.1 and 0.2 map to station 0 (1/3 distance)
		const s1 = teleportStation(source, target, 0.1, { staccato: true });
		const s2 = teleportStation(source, target, 0.2, { staccato: true });

		expect(s1.stepIndex).toBe(0);
		expect(s2.stepIndex).toBe(0);
		expect(s1.pos).toEqual(s2.pos);
		expect(s1.opacity).toEqual(s2.opacity);

		// Position should be 1/3 between source and target
		expect(s1.pos.x).toBeCloseTo(10 + (1 / 3) * 90);
		expect(s1.pos.y).toBeCloseTo(20 + (1 / 3) * 180);
		expect(s1.pos.z).toBeCloseTo(30 + (1 / 3) * 270);
		expect(s1.opacity).toBeGreaterThan(0.3);
		expect(s1.opacity).toBeLessThan(0.7);

		// Progress 0.5 hops to station 1 (2/3 distance)
		const s3 = teleportStation(source, target, 0.5, { staccato: true });
		expect(s3.stepIndex).toBe(1);
		expect(s3.pos.x).toBeCloseTo(10 + (2 / 3) * 90);
		expect(s3.pos.y).toBeCloseTo(20 + (2 / 3) * 180);
		expect(s3.pos.z).toBeCloseTo(30 + (2 / 3) * 270);
		expect(s3.opacity).toBeGreaterThan(s1.opacity);
	});
});
