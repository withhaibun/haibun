import { describe, expect, it } from "vitest";
import { evaluateEgoCorridorHit, pointInBox, pointToSegmentDistance, type TEgoNeighbourTarget } from "./ego-corridor.js";

describe("pointToSegmentDistance", () => {
	it("computes perpendicular distance to horizontal segment", () => {
		const res = pointToSegmentDistance(50, 20, 0, 0, 100, 0);
		expect(res.distance).toBe(20);
		expect(res.t).toBeCloseTo(0.5);
		expect(res.projX).toBeCloseTo(50);
		expect(res.projY).toBeCloseTo(0);
	});

	it("clamps to endpoint A when before start", () => {
		const res = pointToSegmentDistance(-10, 0, 0, 0, 100, 0);
		expect(res.distance).toBe(10);
		expect(res.t).toBe(0);
		expect(res.projX).toBe(0);
	});

	it("clamps to endpoint B when past end", () => {
		const res = pointToSegmentDistance(120, 0, 0, 0, 100, 0);
		expect(res.distance).toBe(20);
		expect(res.t).toBe(1);
		expect(res.projX).toBe(100);
	});
});

describe("pointInBox", () => {
	it("detects points inside box with padding", () => {
		expect(pointInBox(15, 15, 10, 10, 20, 20, 0)).toBe(true);
		expect(pointInBox(5, 5, 10, 10, 20, 20, 6)).toBe(true);
		expect(pointInBox(2, 2, 10, 10, 20, 20, 2)).toBe(false);
	});
});

describe("evaluateEgoCorridorHit", () => {
	const center = { x: 500, y: 400, width: 40, height: 20 };
	const neighbours: TEgoNeighbourTarget[] = [
		{ id: "left-1", pos: { x: 100, y: 400 }, width: 80, height: 20 },
		{ id: "right-1", pos: { x: 900, y: 400 }, width: 80, height: 20 },
	];

	it("detects center hit when pointer is on center node", () => {
		const hit = evaluateEgoCorridorHit({ x: 505, y: 402 }, center, neighbours);
		expect(hit.kind).toBe("center");
	});

	it("detects chip hit when pointer is over a destination neighbour chip", () => {
		const hit = evaluateEgoCorridorHit({ x: 120, y: 400 }, center, neighbours);
		expect(hit.kind).toBe("chip");
		if (hit.kind === "chip") {
			expect(hit.neighbourId).toBe("left-1");
		}
	});

	it("detects spoke hit when pointer moves along the radial connector", () => {
		// Midpoint between center (500, 400) and left-1 (100, 400), with 15px vertical offset
		const hit = evaluateEgoCorridorHit({ x: 300, y: 415 }, center, neighbours, { corridorRadius: 40 });
		expect(hit.kind).toBe("spoke");
		if (hit.kind === "spoke") {
			expect(hit.neighbourId).toBe("left-1");
			expect(hit.spokeDistance).toBeCloseTo(15);
			expect(hit.t).toBeCloseTo(0.5);
		}
	});

	it("returns miss when pointer wanders far into empty space", () => {
		const hit = evaluateEgoCorridorHit({ x: 300, y: 600 }, center, neighbours, { corridorRadius: 40 });
		expect(hit.kind).toBe("miss");
	});
});
