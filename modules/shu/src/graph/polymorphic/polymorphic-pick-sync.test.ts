/**
 * The rule the drag rests on: a pick re-derives its target's matrix EVERY time, because the raycast reads the matrix
 * and the fields it is derived from are written by the layout a frame earlier. A node whose position field already
 * equals the engine's is the dangerous case, not the safe one: its matrix is the stale one, and skipping the update
 * there is the "N nodes, none pickable at centre" failure: every sprite visible, sitting at the node's own
 * coordinates, and picking nothing.
 */
import { describe, it, expect } from "vitest";
import { syncPickTarget, restorePickTarget, type TPickObject } from "./polymorphic-pick-sync.js";

const RESTING = { x: 1, y: 1 };
const MAGNIFIED = { x: 1.4, y: 1.4 };

/** A pick target that records what was written to it and how often its matrix was re-derived. */
function fakeObject(
	at = { x: 0, y: 0, z: 0 },
	scale = { ...RESTING },
): TPickObject & { matrixUpdates: number; position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void } } {
	const o = {
		matrixUpdates: 0,
		position: {
			...at,
			set(x: number, y: number, z: number) {
				o.position.x = x;
				o.position.y = y;
				o.position.z = z;
			},
		},
		scale: {
			...scale,
			set(x: number, y: number, _z: number) {
				o.scale.x = x;
				o.scale.y = y;
			},
		},
		updateMatrixWorld: (_force?: boolean) => {
			o.matrixUpdates++;
		},
	};
	return o;
}

describe("polymorphic pick target sync", () => {
	it("re-derives the matrix even when the target already sits at the node: the stale-matrix case that misses", () => {
		const o = fakeObject({ x: 10, y: -44, z: 532 });
		syncPickTarget(o, { x: 10, y: -44, z: 532, baseScale: RESTING }); // nothing to write: fields already match
		expect(o.matrixUpdates).toBe(1); // ...and the matrix is still re-derived, because that is what the raycast reads
	});

	it("moves the target onto the node's engine coordinates and re-derives the matrix", () => {
		const o = fakeObject({ x: 0, y: 0, z: 0 });
		syncPickTarget(o, { x: 10, y: -44, z: 532, baseScale: RESTING });
		expect(o.position).toMatchObject({ x: 10, y: -44, z: 532 });
		expect(o.matrixUpdates).toBe(1);
	});

	it("picks a magnified node at its resting size, so its hittable area does not grow with the pop", () => {
		const o = fakeObject({ x: 0, y: 0, z: 0 }, MAGNIFIED);
		const restore = syncPickTarget(o, { x: 0, y: 0, z: 0, baseScale: RESTING });
		expect(o.scale).toMatchObject(RESTING);
		expect(restore).toEqual(MAGNIFIED);
	});

	it("puts the magnify back after the raycast, re-deriving the matrix so the pop draws unchanged", () => {
		const o = fakeObject({ x: 0, y: 0, z: 0 }, MAGNIFIED);
		const restore = syncPickTarget(o, { x: 0, y: 0, z: 0, baseScale: RESTING });
		expect(restore).not.toBeNull();
		if (restore) restorePickTarget(o, restore);
		expect(o.scale).toMatchObject(MAGNIFIED);
		expect(o.matrixUpdates).toBe(2); // once to pick at rest, once to put the pop back
	});

	it("reports nothing to restore for a node already at its resting size", () => {
		const o = fakeObject({ x: 0, y: 0, z: 0 }, RESTING);
		expect(syncPickTarget(o, { x: 0, y: 0, z: 0, baseScale: RESTING })).toBeNull();
	});

	it("treats absent node coordinates as the origin rather than skipping the sync", () => {
		const o = fakeObject({ x: 5, y: 5, z: 5 });
		syncPickTarget(o, {});
		expect(o.position).toMatchObject({ x: 0, y: 0, z: 0 });
		expect(o.matrixUpdates).toBe(1);
	});
});
