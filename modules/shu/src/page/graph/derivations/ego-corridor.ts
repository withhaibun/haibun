/**
 * Derivation for ego-overlay hit testing along radial edge spokes and destination chips.
 *
 * Keeps the virtual ego-neighbourhood active as the user moves outward along any spoke
 * towards a destination neighbour chip:
 * - Generous 2D capsule corridors along each spoke so cursor transit is never finnicky.
 * - Hit testing against the central ego node and perimeter chips.
 * - Snaps to the closest spoke when travelling between center and perimeter.
 */

export type TEgoCorridorHit =
	| { kind: "center" }
	| { kind: "chip"; neighbourId: string }
	| { kind: "spoke"; neighbourId: string; spokeDistance: number; t: number }
	| { kind: "miss" };

export type TEgoNeighbourTarget = { id: string; pos: { x: number; y: number }; width: number; height: number; spokePoints?: { x: number; y: number }[] };

export type TEgoCorridorOptions = { corridorRadius?: number; centerPadding?: number; chipPadding?: number };

export const DEFAULT_CORRIDOR_RADIUS = 50;
export const DEFAULT_CENTER_PADDING = 24;
export const DEFAULT_CHIP_PADDING = 12;

/**
 * Computes the minimum 2D Euclidean distance from point P to line segment A->B.
 * Returns the distance, the normalized progress t in [0, 1], and the projected point.
 */
export function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance: number; t: number; projX: number; projY: number } {
	const dx = bx - ax;
	const dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) {
		const d = Math.hypot(px - ax, py - ay);
		return { distance: d, t: 0, projX: ax, projY: ay };
	}
	const rawT = ((px - ax) * dx + (py - ay) * dy) / lenSq;
	const t = Math.max(0, Math.min(1, rawT));
	const projX = ax + t * dx;
	const projY = ay + t * dy;
	const distance = Math.hypot(px - projX, py - projY);
	return { distance, t, projX, projY };
}

/**
 * Tests if point (px, py) lies inside an axis-aligned box with optional padding.
 */
export function pointInBox(px: number, py: number, left: number, top: number, width: number, height: number, padding: number): boolean {
	return px >= left - padding && px <= left + width + padding && py >= top - padding && py <= top + height + padding;
}

/**
 * Evaluates pointer coordinates against the active ego constellation.
 *
 * Precedence:
 * 1. Center node area -> "center"
 * 2. Any neighbour chip bounding box -> "chip"
 * 3. Any spoke corridor within corridorRadius -> "spoke" (closest spoke)
 * 4. Otherwise -> "miss"
 */
export function evaluateEgoCorridorHit(
	pointer: { x: number; y: number },
	center: { x: number; y: number; width?: number; height?: number },
	neighbours: readonly TEgoNeighbourTarget[],
	options?: TEgoCorridorOptions,
): TEgoCorridorHit {
	const centerPad = options && options.centerPadding !== undefined ? options.centerPadding : DEFAULT_CENTER_PADDING;
	const chipPad = options && options.chipPadding !== undefined ? options.chipPadding : DEFAULT_CHIP_PADDING;
	const corridorRadius = options && options.corridorRadius !== undefined ? options.corridorRadius : DEFAULT_CORRIDOR_RADIUS;

	// 1. Center check
	const cW = center.width !== undefined ? center.width : 32;
	const cH = center.height !== undefined ? center.height : 16;
	if (pointInBox(pointer.x, pointer.y, center.x - cW / 2, center.y - cH / 2, cW, cH, centerPad)) {
		return { kind: "center" };
	}

	// 2. Chip bounding box check: n.pos is the chip's center (client coordinates)
	for (const n of neighbours) {
		if (pointInBox(pointer.x, pointer.y, n.pos.x - n.width / 2, n.pos.y - n.height / 2, n.width, n.height, chipPad)) {
			return { kind: "chip", neighbourId: n.id };
		}
	}

	// 3. Spoke corridor check (find closest spoke within corridorRadius, supporting curved polyline spokes)
	let closest: { neighbourId: string; spokeDistance: number; t: number } | undefined;

	for (const n of neighbours) {
		const pts = n.spokePoints;
		if (pts && pts.length > 1) {
			for (let i = 0; i < pts.length - 1; i++) {
				const pA = pts[i];
				const pB = pts[i + 1];
				if (!pA || !pB) continue;
				const seg = pointToSegmentDistance(pointer.x, pointer.y, pA.x, pA.y, pB.x, pB.y);
				if (seg.distance <= corridorRadius) {
					const overallT = (i + seg.t) / (pts.length - 1);
					if (!closest || seg.distance < closest.spokeDistance) {
						closest = { neighbourId: n.id, spokeDistance: seg.distance, t: overallT };
					}
				}
			}
		} else {
			const seg = pointToSegmentDistance(pointer.x, pointer.y, center.x, center.y, n.pos.x, n.pos.y);
			if (seg.distance <= corridorRadius) {
				if (!closest || seg.distance < closest.spokeDistance) {
					closest = { neighbourId: n.id, spokeDistance: seg.distance, t: seg.t };
				}
			}
		}
	}

	if (closest) {
		return { kind: "spoke", neighbourId: closest.neighbourId, spokeDistance: closest.spokeDistance, t: closest.t };
	}

	return { kind: "miss" };
}
