/**
 * The hit test of the ego overlay, in client pixels: the hovered node's box, each off-screen neighbour's chip, and a corridor
 * around each spoke, so a pointer that travels from the node to a chip keeps the overlay shown. The node's box comes first,
 * then a chip, then the nearest spoke within `EGO_CORRIDOR.radius`.
 */

export type TEgoCorridorHit =
	| { kind: "center" }
	| { kind: "chip"; neighbourId: string }
	| { kind: "spoke"; neighbourId: string; spokeDistance: number; t: number }
	| { kind: "miss" };

type TPixel = { x: number; y: number };

/** A box by its centre and its size, in client pixels. */
export type TPixelBox = TPixel & { width: number; height: number };

/** An off-screen neighbour as the hit test reads it: its chip's box and its spoke's points, in client pixels. */
export type TEgoNeighbourTarget = { id: string; box: TPixelBox; spokePoints: TPixel[] };

/** The pixels around the node's box and a chip's box that still hit them, and the radius of a spoke's corridor. */
export const EGO_CORRIDOR = { centerPadding: 32, chipPadding: 24, radius: 55 } as const;

/** Returns the distance from `p` to the segment from `a` to `b`, and the share of the segment at the nearest point. */
export function pointToSegmentDistance(p: TPixel, a: TPixel, b: TPixel): { distance: number; t: number } {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	const lenSq = dx * dx + dy * dy;
	const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
	return { distance: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

/** Whether `p` lies in `box` widened by `padding` on each side. */
export const pointInBox = (p: TPixel, box: TPixelBox, padding: number): boolean =>
	Math.abs(p.x - box.x) <= box.width / 2 + padding && Math.abs(p.y - box.y) <= box.height / 2 + padding;

/** Returns what of the overlay `pointer` hits: the node's box `center`, a neighbour's chip, the nearest spoke within its
 *  corridor, or a miss. */
export function evaluateEgoCorridorHit(pointer: TPixel, center: TPixelBox, neighbours: readonly TEgoNeighbourTarget[]): TEgoCorridorHit {
	if (pointInBox(pointer, center, EGO_CORRIDOR.centerPadding)) return { kind: "center" };
	const chip = neighbours.find(({ box }) => pointInBox(pointer, box, EGO_CORRIDOR.chipPadding));
	if (chip) return { kind: "chip", neighbourId: chip.id };
	let nearest: TEgoCorridorHit & { kind: "spoke" } = { kind: "spoke", neighbourId: "", spokeDistance: EGO_CORRIDOR.radius, t: 0 };
	for (const { id, spokePoints } of neighbours)
		for (let i = 1; i < spokePoints.length; i++) {
			const [a, b] = [spokePoints[i - 1], spokePoints[i]];
			if (a === undefined || b === undefined) throw new Error(`the spoke of ${id} lacks its point ${i}`);
			const { distance, t } = pointToSegmentDistance(pointer, a, b);
			if (distance <= nearest.spokeDistance) nearest = { kind: "spoke", neighbourId: id, spokeDistance: distance, t: (i - 1 + t) / (spokePoints.length - 1) };
		}
	return nearest.neighbourId === "" ? { kind: "miss" } : nearest;
}
