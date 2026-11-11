import { describe, expect, it } from "vitest";
import { EGO_CORRIDOR, evaluateEgoCorridorHit, pointInBox, pointToSegmentDistance, type TEgoNeighbourTarget } from "./ego-corridor.js";

describe("pointToSegmentDistance", () => {
	it("returns the perpendicular distance and the share of the segment at the nearest point", () => {
		expect(pointToSegmentDistance({ x: 50, y: 20 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ distance: 20, t: 0.5 });
	});
	it("clamps to the segment's ends", () => {
		expect(pointToSegmentDistance({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ distance: 10, t: 0 });
		expect(pointToSegmentDistance({ x: 120, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ distance: 20, t: 1 });
	});
});

describe("pointInBox", () => {
	it("holds a point within the box widened by its padding", () => {
		const box = { x: 20, y: 20, width: 20, height: 20 };
		expect(pointInBox({ x: 15, y: 15 }, box, 0)).toBe(true);
		expect(pointInBox({ x: 5, y: 5 }, box, 6)).toBe(true);
		expect(pointInBox({ x: 2, y: 2 }, box, 2)).toBe(false);
	});
});

describe("evaluateEgoCorridorHit", () => {
	const center = { x: 500, y: 400, width: 40, height: 20 };
	const spoke = (to: number) => [
		{ x: 500, y: 400 },
		{ x: (500 + to) / 2, y: 400 },
		{ x: to, y: 400 },
	];
	const neighbours: TEgoNeighbourTarget[] = [
		{ id: "left-1", box: { x: 100, y: 400, width: 80, height: 20 }, spokePoints: spoke(100) },
		{ id: "right-1", box: { x: 900, y: 400, width: 80, height: 20 }, spokePoints: spoke(900) },
	];

	it.each([
		["the node's box", { x: 505, y: 402 }, { kind: "center" }],
		["a chip's right half", { x: 120, y: 400 }, { kind: "chip", neighbourId: "left-1" }],
		["a chip's left half", { x: 75, y: 400 }, { kind: "chip", neighbourId: "left-1" }],
		["a spoke's corridor", { x: 300, y: 415 }, { kind: "spoke", neighbourId: "left-1", spokeDistance: 15, t: 0.5 }],
		["empty space beyond every corridor", { x: 300, y: 400 + EGO_CORRIDOR.radius + 1 }, { kind: "miss" }],
	])("reads a pointer on %s", (_, pointer, hit) => {
		expect(evaluateEgoCorridorHit(pointer, center, neighbours)).toEqual(hit);
	});
});
