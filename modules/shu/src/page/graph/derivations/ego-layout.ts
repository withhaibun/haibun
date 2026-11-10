/**
 * Derivation of the virtual ego-neighborhood overlay.
 *
 * Positions virtual 1-hop neighbours out towards the outer perimeter / edge of the viewport
 * framing the hovered node:
 * - Hovered center node remains unshifted at (x0, y0, z0).
 * - Virtual neighbours are distributed angularly towards the outer edge of the viewport (viewBounds).
 * - Neighbours are placed on the center node's focal plane (z = z0) so font size is uniform
 *   without perspective distortion.
 * - Staggers radii across inner/outer edge tiers to avoid congestion.
 * - Applies 2D AABB collision relaxation along the perimeter so chips never overlap.
 * - Staggers and offsets edge predicate labels perpendicularly.
 */
import { isPlaced, linkEndId, type FGLink, type FGNode, type XYZ } from "../domains/graph-types.js";

export type TEgoNeighbour = { node: FGNode & XYZ; link: FGLink; direction: "out" | "in" };

export type TEgoGraph = { center: FGNode & XYZ; neighbours: TEgoNeighbour[]; totalNeighbours: number };

export type TEgoPositionedNeighbour = { node: FGNode & XYZ; link: FGLink; direction: "out" | "in"; pos: XYZ; predicatePos: XYZ; isOffscreen?: boolean; spokePoints: XYZ[] };

export type TEgoPositions = { center: XYZ; neighbours: TEgoPositionedNeighbour[]; scale: number };

export type TEgoPositionOptions = {
	viewBounds?: { rx: number; ry: number };
	focalPlane?: boolean;
	camBasis?: { right: XYZ; up: XYZ };
	project?: (point: XYZ) => TNdcPoint;
	curvature?: number;
};

export const DEFAULT_MAX_EGO_NEIGHBOURS = 16;
export const DEFAULT_VIEWPORT_MARGIN = 0.88;
export const VIEWPORT_ONSCREEN_MARGIN = 1.0;
export const VIRTUAL_PERIMETER_MARGIN = 0.88;
export const GRAPH_LINK_CURVATURE = 0.25;

export const EGO_RING_INNER_RADIUS = 48;
export const EGO_RING_OUTER_RADIUS = 74;
export const EGO_CHIP_HEIGHT = 4.2;
export const EGO_COLLISION_PADDING = 2.8;
export const EGO_PREDICATE_OFFSET = 3.2;

/**
 * Calculates a 3D point along the curved edge between two nodes.
 * Matches three-forcegraph's quadratic bezier formulation with linkCurvature:
 * - u = 0 is center node
 * - u = 1 is neighbour node
 * - 0 < u < 1 samples along the curve
 */
export function pointAlongLink(center: XYZ, neighbour: XYZ, direction: "out" | "in", curvature: number, u: number): XYZ {
	const source = direction === "out" ? center : neighbour;
	const target = direction === "out" ? neighbour : center;
	const t = direction === "out" ? u : 1 - u;

	if (curvature === 0) {
		return { x: source.x + t * (target.x - source.x), y: source.y + t * (target.y - source.y), z: source.z + t * (target.z - source.z) };
	}

	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const dz = target.z - source.z;
	const midX = (source.x + target.x) / 2;
	const midY = (source.y + target.y) / 2;
	const midZ = (source.z + target.z) / 2;

	let offX = 0;
	let offY = 0;
	let offZ = 0;
	if (dx !== 0 || dy !== 0) {
		offX = curvature * dy;
		offY = -curvature * dx;
		offZ = 0;
	} else {
		offX = -curvature * dz;
	}

	const cpX = midX + offX;
	const cpY = midY + offY;
	const cpZ = midZ + offZ;

	const mt = 1 - t;
	const a = mt * mt;
	const b = 2 * mt * t;
	const c = t * t;

	return { x: a * source.x + b * cpX + c * target.x, y: a * source.y + b * cpY + c * target.y, z: a * source.z + b * cpZ + c * target.z };
}

/** Samples N points along the curved spoke from u = 0 (center) to u = targetU. */
export function sampleCurvedSpoke(center: XYZ, neighbour: XYZ, direction: "out" | "in", curvature: number, targetU: number, segments?: number): XYZ[] {
	const count = segments !== undefined ? segments : 12;
	const points: XYZ[] = [];
	for (let i = 0; i <= count; i++) {
		const u = (i / count) * targetU;
		points.push(pointAlongLink(center, neighbour, direction, curvature, u));
	}
	return points;
}

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

type TConstellationItem = {
	item: TEgoNeighbour;
	angle: number;
	width: number;
	tier: number;
	isOffscreen: boolean;
	x: number;
	y: number;
	z: number;
	predicatePos: XYZ;
	spokePoints: XYZ[];
};

/**
 * Computes curved perimeter positions along each real edge's curve:
 * - Neighbours already in the visible viewport DO NOT MOVE (stay at original x, y, z).
 * - Off-screen neighbours are placed along the curved edge at the visible perimeter.
 * - Staggers radial curve parameter across tiers for neighbours sharing similar angles.
 * - Guarantees that the virtual spoke exactly overlaps the real curved edge line.
 */
function layoutConstellation(
	ego: TEgoGraph,
	bounds?: { rx: number; ry: number },
	camBasis?: { right: XYZ; up: XYZ },
	project?: (point: XYZ) => TNdcPoint,
	curvatureOption?: number,
	focalPlane?: boolean,
): TConstellationItem[] {
	const { center, neighbours } = ego;
	const count = neighbours.length;
	if (count === 0) return [];

	const x0 = center.x;
	const y0 = center.y;
	const z0 = center.z;

	const rx = bounds ? bounds.rx : EGO_RING_OUTER_RADIUS;
	const ry = bounds ? bounds.ry : EGO_RING_INNER_RADIUS;
	const baseRadius = Math.max(48, Math.min(rx, ry) * 0.92);
	const curvature = curvatureOption !== undefined ? curvatureOption : GRAPH_LINK_CURVATURE;

	// 1. Calculate ray directions, angles, and viewport visibility for each neighbour
	const items: TConstellationItem[] = neighbours.map((item, idx) => {
		const dx = item.node.x - x0;
		const dy = item.node.y - y0;
		const dz = item.node.z - z0;

		// Project direction to camera basis (screen plane) to determine angular ordering
		const sx = camBasis ? dx * camBasis.right.x + dy * camBasis.right.y + dz * camBasis.right.z : dx;
		const sy = camBasis ? dx * camBasis.up.x + dy * camBasis.up.y + dz * camBasis.up.z : dy;
		const angle = Math.hypot(sx, sy) > 0.001 ? Math.atan2(sy, sx) : -Math.PI + (2 * Math.PI * idx) / count;
		const width = approximateChipWidth(item.node.name);

		let isVisible = false;
		if (project) {
			const ndc = project(item.node);
			isVisible = ndc.inFront && Math.abs(ndc.x) <= VIEWPORT_ONSCREEN_MARGIN && Math.abs(ndc.y) <= VIEWPORT_ONSCREEN_MARGIN;
		} else if (bounds) {
			isVisible = Math.abs(sx) <= bounds.rx && Math.abs(sy) <= bounds.ry;
		} else {
			isVisible = Math.hypot(dx, dy) <= EGO_RING_INNER_RADIUS;
		}

		return { item, angle, width, tier: 0, isOffscreen: !isVisible, x: item.node.x, y: item.node.y, z: item.node.z, predicatePos: { x: x0, y: y0, z: z0 }, spokePoints: [] };
	});

	// 2. Sort by angular position around center
	items.sort((a, b) => a.angle - b.angle);

	// 3. Stagger radial distance across tiers for off-screen neighbours with similar angles (< 25 degrees / ~0.44 rad)
	const MIN_ANGULAR_GAP = 0.44;
	for (let i = 0; i < items.length; i++) {
		const current = items[i];
		if (!current) continue;
		let tier = 0;
		for (let j = 0; j < i; j++) {
			const prev = items[j];
			if (!prev) continue;
			const angleDiff = Math.abs(current.angle - prev.angle);
			if (angleDiff < MIN_ANGULAR_GAP && prev.tier >= tier) {
				tier = prev.tier + 1;
			}
		}
		current.tier = tier;
	}

	// 4. Place each neighbour along the curve of the edge
	for (const entry of items) {
		if (!entry.isOffscreen) {
			// Node is already in visible viewport: DO NOT MOVE IT!
			entry.x = entry.item.node.x;
			entry.y = entry.item.node.y;
			entry.z = entry.item.node.z;
			entry.predicatePos = pointAlongLink(center, entry.item.node, entry.item.direction, curvature, 0.5);
			entry.spokePoints = sampleCurvedSpoke(center, entry.item.node, entry.item.direction, curvature, 1.0);
			continue;
		}

		// Find where the curved edge reaches the visible perimeter
		let low = 0.05;
		let high = 1.0;
		for (let iter = 0; iter < 10; iter++) {
			const mid = (low + high) / 2;
			const pt = pointAlongLink(center, entry.item.node, entry.item.direction, curvature, mid);
			let inside = false;
			if (project) {
				const ndc = project(pt);
				inside = ndc.inFront && Math.abs(ndc.x) <= VIRTUAL_PERIMETER_MARGIN && Math.abs(ndc.y) <= VIRTUAL_PERIMETER_MARGIN;
			} else if (bounds) {
				inside = Math.abs(pt.x - x0) <= bounds.rx && Math.abs(pt.y - y0) <= bounds.ry;
			} else {
				inside = Math.hypot(pt.x - x0, pt.y - y0) <= baseRadius;
			}
			if (inside) {
				low = mid;
			} else {
				high = mid;
			}
		}

		const tierReduction = Math.max(0.85, 1.0 - entry.tier * 0.04);
		const targetU = Math.max(0.08, low * tierReduction);
		const perimPt = pointAlongLink(center, entry.item.node, entry.item.direction, curvature, targetU);
		entry.x = perimPt.x;
		entry.y = perimPt.y;
		entry.z = focalPlane ? perimPt.z : entry.item.node.z;
		entry.predicatePos = pointAlongLink(center, entry.item.node, entry.item.direction, curvature, targetU * 0.5);
		entry.spokePoints = sampleCurvedSpoke(center, entry.item.node, entry.item.direction, curvature, targetU);
	}

	// 5. 2D AABB collision relaxation pass in camera plane so virtual perimeter chips never overlap
	const right = camBasis ? camBasis.right : { x: 1, y: 0, z: 0 };
	const up = camBasis ? camBasis.up : { x: 0, y: 1, z: 0 };

	const offscreenItems = items.filter((item) => item.isOffscreen);
	if (offscreenItems.length > 1) {
		const pad = 3.0;
		const chipH = EGO_CHIP_HEIGHT + 1.2;

		// Project 3D positions onto screen plane (sx, sy) relative to center
		const screenPos = offscreenItems.map((entry) => {
			const dx = entry.x - x0;
			const dy = entry.y - y0;
			const dz = entry.z - z0;
			const sx = dx * right.x + dy * right.y + dz * right.z;
			const sy = dx * up.x + dy * up.y + dz * up.z;
			const w = entry.width + 6.0;
			return { entry, sx, sy, origSx: sx, origSy: sy, w, h: chipH };
		});

		const relaxIterations = 24;
		for (let iter = 0; iter < relaxIterations; iter++) {
			for (let i = 0; i < screenPos.length; i++) {
				const itemA = screenPos[i];
				if (!itemA) continue;
				for (let j = i + 1; j < screenPos.length; j++) {
					const itemB = screenPos[j];
					if (!itemB) continue;

					const dx = itemB.sx - itemA.sx;
					const dy = itemB.sy - itemA.sy;
					const minX = (itemA.w + itemB.w) / 2 + pad;
					const minY = (itemA.h + itemB.h) / 2 + pad;
					const ovX = minX - Math.abs(dx);
					const ovY = minY - Math.abs(dy);

					if (ovX > 0 && ovY > 0) {
						if (ovY < ovX) {
							const shift = (ovY / 2) * (dy < 0 ? -1 : 1);
							itemA.sy -= shift;
							itemB.sy += shift;
						} else {
							const shift = (ovX / 2) * (dx < 0 ? -1 : 1);
							itemA.sx -= shift;
							itemB.sx += shift;
						}
					}
				}
			}
		}

		// Apply relaxed camera plane displacements back to 3D positions
		for (const sp of screenPos) {
			const dsx = sp.sx - sp.origSx;
			const dsy = sp.sy - sp.origSy;
			sp.entry.x += dsx * right.x + dsy * up.x;
			sp.entry.y += dsx * right.y + dsy * up.y;
			sp.entry.z += dsx * right.z + dsy * up.z;

			// Append relaxed chip endpoint to spokePoints so spoke ends cleanly at chip
			if (sp.entry.spokePoints.length > 0) {
				const lastIdx = sp.entry.spokePoints.length - 1;
				sp.entry.spokePoints[lastIdx] = { x: sp.entry.x, y: sp.entry.y, z: sp.entry.z };
			}
		}
	}

	return items;
}

/**
 * Computes ego overlay positions:
 * - Center is unchanged: (x0, y0, z0).
 * - Visible on-screen neighbours remain unshifted at their real coordinates.
 * - Off-screen neighbours are placed along the curved edge at the visible perimeter.
 * - Predicate positions and spoke points lie strictly on the curved edge.
 */
export function computeEgoPositions(ego: TEgoGraph, scale: number, options?: TEgoPositionOptions): TEgoPositions {
	const { center } = ego;
	const s = Math.max(0.2, Math.min(scale, 1));
	const x0 = center.x;
	const y0 = center.y;
	const z0 = center.z;

	const constellation = layoutConstellation(ego, options?.viewBounds, options?.camBasis, options?.project, options?.curvature, options?.focalPlane);

	const neighbours: TEgoPositionedNeighbour[] = constellation.map((entry) => {
		// Only scale off-screen positions; on-screen nodes stay fixed at their real coordinates
		const targetX = entry.isOffscreen ? x0 + s * (entry.x - x0) : entry.x;
		const targetY = entry.isOffscreen ? y0 + s * (entry.y - y0) : entry.y;
		const targetZ = entry.isOffscreen && options?.focalPlane ? z0 + s * (entry.z - z0) : entry.z;

		return {
			node: entry.item.node,
			link: entry.item.link,
			direction: entry.item.direction,
			pos: { x: targetX, y: targetY, z: targetZ },
			predicatePos: entry.predicatePos,
			isOffscreen: entry.isOffscreen,
			spokePoints: entry.spokePoints,
		};
	});

	return { center: { x: x0, y: y0, z: z0 }, neighbours, scale: s };
}

export type TNdcPoint = { x: number; y: number; inFront: boolean };

/**
 * Determines optimal lateral scale factor s in (0.3, 1] so that every neighbour's projected
 * position falls within the NDC bounds [-margin, margin] and remains in front of the camera.
 */
export function computeViewportFitScale(ego: TEgoGraph, project: (point: XYZ) => TNdcPoint, margin: number, options?: TEgoPositionOptions): number {
	if (ego.neighbours.length === 0) return 1.0;

	const testScale = (s: number): boolean => {
		const positions = computeEgoPositions(ego, s, options);
		for (const n of positions.neighbours) {
			if (!n.isOffscreen) continue;
			const ndc = project(n.pos);
			if (!ndc.inFront) return false;
			if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin) {
				return false;
			}
		}
		return true;
	};

	if (testScale(1.0)) return 1.0;

	// Binary search for maximum scale in [0.4, 1.0] to keep chips near perimeter without clumping
	let low = 0.4;
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
