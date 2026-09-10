/**
 * Bringing a node's pick target into the state a pick must raycast against.
 *
 * A raycast reads an object's MATRIX, never its position/scale fields. Those are written by the layout and the magnify;
 * the matrix is re-derived by the next render. So between a write and the next frame the fields are current and the
 * matrix is one frame behind, and a pick then misses every node, at the very pixel the projection says it is drawn at.
 * The matrix is therefore re-derived on every pick, whether or not anything moved: "the field already matches" says
 * nothing about the matrix, and is exactly the case that misses.
 *
 * Split out from the raycast so this rule is provable without a browser (polymorphic-pick-sync.test.ts).
 */

/** The pick-target side: the fields a pick writes, and the matrix it must re-derive. */
export type TPickObject = {
	position?: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
	scale: { x: number; y: number; set(x: number, y: number, z: number): void };
	updateMatrixWorld?: (force?: boolean) => void;
};

/** The node side: where the engine says the node is, and the size it rests at. */
export type TPickNode = { x?: number; y?: number; z?: number; baseScale?: { x: number; y: number } };

/** A scale to put back after the raycast: the live magnify, replaced by the resting size while picking. */
export type TScaleRestore = { x: number; y: number };

/**
 * Point `object` at the node's engine coordinates and its resting size, then re-derive its matrix. Returns the scale
 * the caller must restore after the raycast (the live magnify), or null when nothing was resized.
 *
 * Picking at the resting size keeps a magnified node's hittable area from growing with its pop: a hovered node would
 * otherwise capture presses aimed around it.
 */
export function syncPickTarget(object: TPickObject, node: TPickNode): TScaleRestore | null {
	const { x = 0, y = 0, z = 0 } = node;
	if (object.position && (object.position.x !== x || object.position.y !== y || object.position.z !== z)) object.position.set(x, y, z);

	let restore: TScaleRestore | null = null;
	const base = node.baseScale;
	if (base && (object.scale.x !== base.x || object.scale.y !== base.y)) {
		restore = { x: object.scale.x, y: object.scale.y };
		object.scale.set(base.x, base.y, 1);
	}

	object.updateMatrixWorld?.(true);
	return restore;
}

/** Put a magnified scale back after the raycast, re-deriving the matrix so the next frame draws the pop unchanged. */
export function restorePickTarget(object: TPickObject, scale: TScaleRestore): void {
	object.scale.set(scale.x, scale.y, 1);
	object.updateMatrixWorld?.(true);
}
