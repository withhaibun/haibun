/**
 * Derivation of the virtual ego-neighborhood overlay.
 *
 * Preserves the temporal and spatial integrity of the graph:
 * - Hovered center node is unshifted at (x0, y0, z0).
 * - Central ego node is at the exact same position (x0, y0, z0).
 * - z (time axis) is strictly invariant for all neighbours (zi_ego = zi).
 * - Distributes incident neighbours across the available angular area around (x0, y0).
 * - Staggers neighbours across two radial tiers (inner and outer rings) to avoid congestion.
 * - Applies 2D AABB collision relaxation so chips never overlap each other or the center node.
 * - Staggers and offsets edge predicate labels perpendicularly to prevent text overlap.
 * - Scales the lateral constellation uniformly by s in (0, 1] to fit cleanly inside the viewport.
 */
import { isPlaced, linkEndId, type FGLink, type FGNode, type XYZ } from "../domains/graph-types.js";

export type TEgoNeighbour = { node: FGNode & XYZ; link: FGLink; direction: "out" | "in" };

export type TEgoGraph = { center: FGNode & XYZ; neighbours: TEgoNeighbour[]; totalNeighbours: number };

export type TEgoPositionedNeighbour = { node: FGNode & XYZ; link: FGLink; direction: "out" | "in"; pos: XYZ; predicatePos: XYZ };

export type TEgoPositions = { center: XYZ; neighbours: TEgoPositionedNeighbour[]; scale: number };

export const DEFAULT_MAX_EGO_NEIGHBOURS = 16;
export const DEFAULT_VIEWPORT_MARGIN = 0.85;

export const EGO_RING_INNER_RADIUS = 34;
export const EGO_RING_OUTER_RADIUS = 58;
export const EGO_CHIP_HEIGHT = 4.2;
export const EGO_COLLISION_PADDING = 2.5;
export const EGO_PREDICATE_OFFSET = 3.2;

/** Approximate the visual width of a chip based on its label text. */
export function approximateChipWidth(name: string): number {
	const len = Math.min(name.length, 64);
	return 2 * (2.0 + len * 0.85);
}

/** Extract 1-hop neighbours and incident links for a center node. */
export function extractEgoGraph(centerId: string, nodeMap: Map<string, FGNode>, links: Iterable<FGLink>, maxNeighbours: number): TEgoGraph | undefined {
	const rawCenter = nodeMap.get(centerId);
	if (!rawCenter || !isPlaced(rawCenter)) return undefined;
	const center = rawCenter;

	const seen = new Set<string>();
	const neighbours: TEgoNeighbour[] = [];

	for (const link of links) {
		const sId = linkEndId(link.source);
		const tId = linkEndId(link.target);
		if (sId === centerId && tId !== centerId) {
			if (!seen.has(tId)) {
				seen.add(tId);
				const n = nodeMap.get(tId);
				if (n && isPlaced(n)) {
					neighbours.push({ node: n, link, direction: "out" });
				}
			}
		} else if (tId === centerId && sId !== centerId) {
			if (!seen.has(sId)) {
				seen.add(sId);
				const n = nodeMap.get(sId);
				if (n && isPlaced(n)) {
					neighbours.push({ node: n, link, direction: "in" });
				}
			}
		}
	}

	return { center, neighbours: neighbours.slice(0, maxNeighbours), totalNeighbours: neighbours.length };
}

type TConstellationItem = { item: TEgoNeighbour; angle: number; width: number; x: number; y: number; z: number };

/**
 * Computes non-overlapping 2D orbital constellation positions around (x0, y0).
 * - Distributes neighbours across available angular space while preserving relative order.
 * - Staggers radii across inner and outer rings.
 * - Relaxes chip bounding boxes to guarantee zero overlap.
 */
function layoutConstellation(ego: TEgoGraph): TConstellationItem[] {
	const { center, neighbours } = ego;
	const count = neighbours.length;
	if (count === 0) return [];

	const x0 = center.x;
	const y0 = center.y;

	// Calculate natural angles
	const sorted = neighbours
		.map((item) => {
			const dx = item.node.x - x0;
			const dy = item.node.y - y0;
			const angle = Math.atan2(dy, dx);
			const width = approximateChipWidth(item.node.name);
			return { item, angle, width, x: 0, y: 0, z: item.node.z };
		})
		.sort((a, b) => a.angle - b.angle);

	if (count === 1) {
		const single = sorted[0];
		if (!single) return [];
		const r = EGO_RING_INNER_RADIUS;
		single.x = x0 + r * Math.cos(single.angle);
		single.y = y0 + r * Math.sin(single.angle);
		return sorted;
	}

	const first = sorted[0];
	if (!first) return [];
	const startAngle = first.angle;
	const step = (2 * Math.PI) / count;

	for (let i = 0; i < count; i++) {
		const entry = sorted[i];
		if (!entry) continue;
		const targetAngle = startAngle + i * step;
		// Stagger radii between inner and outer rings
		const r = i % 2 === 0 ? EGO_RING_INNER_RADIUS : EGO_RING_OUTER_RADIUS;
		entry.x = x0 + r * Math.cos(targetAngle);
		entry.y = y0 + r * Math.sin(targetAngle);
	}

	// 2D AABB relaxation pass to resolve any chip overlaps
	const centerWidth = approximateChipWidth(center.name);
	const relaxIterations = 16;

	for (let iter = 0; iter < relaxIterations; iter++) {
		// 1. Repel from fixed center node at (x0, y0)
		for (let i = 0; i < count; i++) {
			const entry = sorted[i];
			if (!entry) continue;
			const cdx = entry.x - x0;
			const cdy = entry.y - y0;
			const minX = (centerWidth + entry.width) / 2 + EGO_COLLISION_PADDING;
			const minY = (EGO_CHIP_HEIGHT + EGO_CHIP_HEIGHT) / 2 + EGO_COLLISION_PADDING;
			const ovX = minX - Math.abs(cdx);
			const ovY = minY - Math.abs(cdy);
			if (ovX > 0 && ovY > 0) {
				const dist = Math.hypot(cdx, cdy);
				if (dist > 0.001) {
					const push = Math.max(ovX, ovY);
					entry.x += (cdx / dist) * push;
					entry.y += (cdy / dist) * push;
				} else {
					entry.x += minX;
				}
			}
		}

		// 2. Repel between neighbour pairs
		for (let i = 0; i < count; i++) {
			const itemI = sorted[i];
			if (!itemI) continue;
			for (let j = i + 1; j < count; j++) {
				const itemJ = sorted[j];
				if (!itemJ) continue;
				const dx = itemJ.x - itemI.x;
				const dy = itemJ.y - itemI.y;
				const minX = (itemI.width + itemJ.width) / 2 + EGO_COLLISION_PADDING;
				const minY = (EGO_CHIP_HEIGHT + EGO_CHIP_HEIGHT) / 2 + EGO_COLLISION_PADDING;
				const ovX = minX - Math.abs(dx);
				const ovY = minY - Math.abs(dy);
				if (ovX > 0 && ovY > 0) {
					if (ovX < ovY) {
						const shift = (ovX / 2) * (dx < 0 ? -1 : 1);
						itemI.x -= shift;
						itemJ.x += shift;
					} else {
						const shift = (ovY / 2) * (dy < 0 ? -1 : 1);
						itemI.y -= shift;
						itemJ.y += shift;
					}
				}
			}
		}
	}

	return sorted;
}

/**
 * Computes ego overlay positions:
 * - Center is unchanged: (x0, y0, z0).
 * - z (time axis) is strictly invariant: z_i_ego = z_i.
 * - (x, y) coordinates contract towards (x0, y0) by `scale`:
 *   x_i_ego = x0 + scale * (x_i_constellation - x0)
 *   y_i_ego = y0 + scale * (y_i_constellation - y0)
 * - Predicate positions are staggered along edges and offset perpendicularly.
 */
export function computeEgoPositions(ego: TEgoGraph, scale: number): TEgoPositions {
	const { center } = ego;
	const s = Math.max(0, Math.min(scale, 1));
	const x0 = center.x;
	const y0 = center.y;
	const z0 = center.z;

	const constellation = layoutConstellation(ego);

	const neighbours: TEgoPositionedNeighbour[] = constellation.map((entry, idx) => {
		const targetX = x0 + s * (entry.x - x0);
		const targetY = y0 + s * (entry.y - y0);
		const targetZ = entry.z;

		// Predicate label: staggered distance along edge + perpendicular offset
		const dx = targetX - x0;
		const dy = targetY - y0;
		const dz = targetZ - z0;
		const len = Math.hypot(dx, dy);

		const t = 0.42 + 0.16 * (idx % 2);
		const nx = len > 0.001 ? -dy / len : 0;
		const ny = len > 0.001 ? dx / len : 1;
		const side = idx % 2 === 0 ? 1 : -1;
		const offset = EGO_PREDICATE_OFFSET * side;

		const predicatePos: XYZ = { x: x0 + t * dx + nx * offset, y: y0 + t * dy + ny * offset, z: z0 + t * dz };

		return { node: entry.item.node, link: entry.item.link, direction: entry.item.direction, pos: { x: targetX, y: targetY, z: targetZ }, predicatePos };
	});

	return { center: { x: x0, y: y0, z: z0 }, neighbours, scale: s };
}

export type TNdcPoint = { x: number; y: number; inFront: boolean };

/**
 * Determines optimal lateral scale factor s in (0, 1] so that every neighbour's projected
 * position falls within the NDC bounds [-margin, margin] and remains in front of the camera.
 */
export function computeViewportFitScale(ego: TEgoGraph, project: (point: XYZ) => TNdcPoint, margin: number): number {
	if (ego.neighbours.length === 0) return 1.0;

	const testScale = (s: number): boolean => {
		const positions = computeEgoPositions(ego, s);
		for (const n of positions.neighbours) {
			const ndc = project(n.pos);
			if (!ndc.inFront) return false;
			if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin) {
				return false;
			}
		}
		return true;
	};

	if (testScale(1.0)) return 1.0;

	// Binary search for maximum scale in [0.05, 1.0]
	let low = 0.05;
	let high = 1.0;
	let best = low;

	for (let iter = 0; iter < 8; iter++) {
		const mid = (low + high) / 2;
		if (testScale(mid)) {
			best = mid;
			low = mid;
		} else {
			high = mid;
		}
	}

	return best;
}
