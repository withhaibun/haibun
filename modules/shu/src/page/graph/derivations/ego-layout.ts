/**
 * The layout of the ego overlay: the 1-hop neighbours of a hovered node, and where the overlay shows each neighbour outside
 * the viewport. The hovered node stays where it is. A neighbour inside the viewport isn't moved and doesn't get a chip, since
 * the scene already draws it and its edge. An off-screen neighbour's chip is placed where its edge's curve crosses the
 * viewport's margin, so its spoke lies on the edge the scene draws. Where the curve crosses within the first
 * `EGO_MIN_CROSSING` of its length, the chip is placed where the straight direction to the neighbour reaches the margin. Chips
 * that overlap are then moved apart along the margin.
 */
import { isPlaced, linkEndId, type FGLink, type FGNode, type XYZ } from "../domains/graph-types.js";

export type TEgoNeighbour = { node: FGNode & XYZ; link: FGLink; direction: "out" | "in" };

/** A hovered node, the neighbours the overlay reads, and how many neighbours the node has. */
export type TEgoGraph = { center: FGNode & XYZ; neighbours: TEgoNeighbour[]; totalNeighbours: number };

/** An off-screen neighbour as the overlay shows it: its chip's place, its predicate's place, and the points of its spoke. */
export type TEgoPlaced = TEgoNeighbour & { pos: XYZ; predicatePos: XYZ; spokePoints: XYZ[] };

/** A point in normalized device coordinates, and whether it is in front of the camera. */
export type TNdcPoint = { x: number; y: number; inFront: boolean };

/** The camera as the layout reads it: its right and up directions, its projection, and the margin's half extents in world
 *  units at the hovered node. */
export type TEgoView = { basis: { right: XYZ; up: XYZ }; project: (point: XYZ) => TNdcPoint; bounds: { rx: number; ry: number } };

/** How many neighbours the overlay reads; a count chip states the rest. */
export const MAX_EGO_NEIGHBOURS = 16;
/** The curvature of the scene's links, which a spoke follows. */
export const GRAPH_LINK_CURVATURE = 0.25;
export const EGO_CHIP_HEIGHT = 4.2;
/** The share of the viewport's half extent within which a chip is placed, so its text stays on screen. */
export const EGO_VIEWPORT_MARGIN = 0.88;
/** The width a chip's avatar and padding add to its text. */
export const EGO_CHIP_PADDING = 6;
const CHIP_TEXT = { base: 2, perChar: 0.85, maxChars: 64 } as const;
const SPOKE_SEGMENTS = 12;
const CROSSING_ITERATIONS = 12;
const EGO_MIN_CROSSING = 0.2;
const RELAX_ITERATIONS = 24;
/** The space kept between two chips, and the height of a chip's row. */
const CHIP_GAP = 3;
const CHIP_ROW = EGO_CHIP_HEIGHT + 1.2;
/** A projected length below which a direction doesn't state an angle. */
const NO_DIRECTION = 0.001;

const add = (p: XYZ, d: XYZ, k: number): XYZ => ({ x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k });
const dot = (a: XYZ, b: XYZ): number => a.x * b.x + a.y * b.y + a.z * b.z;
const minus = (a: XYZ, b: XYZ): XYZ => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const within = ({ x, y, inFront }: TNdcPoint, margin: number): boolean => inFront && Math.abs(x) <= margin && Math.abs(y) <= margin;

/** Returns the point at share `u` of the curved link from `center` (u = 0) to `neighbour` (u = 1), on the quadratic Bézier
 *  curve three-forcegraph draws for a link of `GRAPH_LINK_CURVATURE` from its source to its target. */
export function pointAlongLink(center: XYZ, neighbour: XYZ, direction: "out" | "in", u: number): XYZ {
	const [source, target, t] = direction === "out" ? [center, neighbour, u] : [neighbour, center, 1 - u];
	const d = minus(target, source);
	const offset = d.x !== 0 || d.y !== 0 ? { x: d.y, y: -d.x, z: 0 } : { x: -d.z, y: 0, z: 0 };
	const control = add(add(source, d, 0.5), offset, GRAPH_LINK_CURVATURE);
	const [a, b, c] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
	return { x: a * source.x + b * control.x + c * target.x, y: a * source.y + b * control.y + c * target.y, z: a * source.z + b * control.z + c * target.z };
}

const spokeOf = (n: TEgoNeighbour, center: XYZ, toU: number): XYZ[] =>
	Array.from({ length: SPOKE_SEGMENTS + 1 }, (_, i) => pointAlongLink(center, n.node, n.direction, (i / SPOKE_SEGMENTS) * toU));

/** Returns the width of a chip that reads `name`. */
export const approximateChipWidth = (name: string): number => 2 * (CHIP_TEXT.base + Math.min(name.length, CHIP_TEXT.maxChars) * CHIP_TEXT.perChar);

/** Returns the hovered node `centerId` with its neighbours by each link, the first `MAX_EGO_NEIGHBOURS` of them, and how many
 *  there are. Undefined where the node isn't placed. */
export function extractEgoGraph(centerId: string, nodeMap: Map<string, FGNode>, links: Iterable<FGLink>): TEgoGraph | undefined {
	const center = nodeMap.get(centerId);
	if (!center || !isPlaced(center)) return undefined;
	const neighbours = new Map<string, TEgoNeighbour>();
	for (const link of links) {
		const [from, to] = [linkEndId(link.source), linkEndId(link.target)];
		const [otherId, direction] = from === centerId ? [to, "out" as const] : [from, "in" as const];
		if ((from === centerId) === (to === centerId) || neighbours.has(otherId)) continue;
		const node = nodeMap.get(otherId);
		if (node && isPlaced(node)) neighbours.set(otherId, { node, link, direction });
	}
	return { center, neighbours: [...neighbours.values()].slice(0, MAX_EGO_NEIGHBOURS), totalNeighbours: neighbours.size };
}

/** Returns the share of a neighbour's link at which its curve leaves the viewport's margin, by bisection. */
function crossingOf(n: TEgoNeighbour, center: XYZ, view: TEgoView): number {
	let [inside, outside] = [0, 1];
	for (let i = 0; i < CROSSING_ITERATIONS; i++) {
		const mid = (inside + outside) / 2;
		if (within(view.project(pointAlongLink(center, n.node, n.direction, mid)), EGO_VIEWPORT_MARGIN)) inside = mid;
		else outside = mid;
	}
	return inside;
}

/** Returns where the straight direction (sx, sy) from `center` reaches the margin. A direction too short to state an angle
 *  takes `spread`, the neighbour's share of a turn, so the chip lands on the margin. */
function marginPoint(center: XYZ, sx: number, sy: number, spread: number, { basis, bounds }: TEgoView): XYZ {
	const [dx, dy] = Math.hypot(sx, sy) > NO_DIRECTION ? [sx, sy] : [Math.cos(2 * Math.PI * spread), Math.sin(2 * Math.PI * spread)];
	const t = Math.min(Math.abs(dx) > NO_DIRECTION ? bounds.rx / Math.abs(dx) : Infinity, Math.abs(dy) > NO_DIRECTION ? bounds.ry / Math.abs(dy) : Infinity);
	return add(add(center, basis.right, dx * t), basis.up, dy * t);
}

/** Moves overlapping chips apart along the margin: across the screen near its top or bottom, and up the screen near its
 *  sides, in the camera's plane. A spoke ends at its chip. */
function relax(placed: TEgoPlaced[], center: XYZ, { basis }: TEgoView): void {
	const chips = placed.map((p) => ({
		p,
		sx: dot(minus(p.pos, center), basis.right),
		sy: dot(minus(p.pos, center), basis.up),
		w: approximateChipWidth(p.node.name) + EGO_CHIP_PADDING,
	}));
	const moved = chips.map(({ sx, sy }) => ({ sx, sy }));
	for (let iter = 0; iter < RELAX_ITERATIONS; iter++)
		for (let i = 0; i < chips.length; i++)
			for (let j = i + 1; j < chips.length; j++) {
				const [a, b] = [chips[i], chips[j]];
				if (a === undefined || b === undefined) throw new Error(`relax reads chips ${i} and ${j} of ${chips.length}`);
				const [dx, dy] = [b.sx - a.sx, b.sy - a.sy];
				const overlapX = (a.w + b.w) / 2 + CHIP_GAP - Math.abs(dx);
				const overlapY = CHIP_ROW + CHIP_GAP - Math.abs(dy);
				if (overlapX <= 0 || overlapY <= 0) continue;
				const acrossScreen = Math.abs(a.sy) > Math.abs(a.sx);
				const shift = (acrossScreen ? overlapX : overlapY) / 2;
				const sign = (acrossScreen ? dx : dy) < 0 ? -1 : 1;
				if (acrossScreen) [a.sx, b.sx] = [a.sx - shift * sign, b.sx + shift * sign];
				else [a.sy, b.sy] = [a.sy - shift * sign, b.sy + shift * sign];
			}
	chips.forEach(({ p, sx, sy }, i) => {
		const from = moved[i];
		if (from === undefined) throw new Error(`relax moves chip ${i} without its start`);
		p.pos = add(add(p.pos, basis.right, sx - from.sx), basis.up, sy - from.sy);
		p.spokePoints[p.spokePoints.length - 1] = p.pos;
	});
}

/** Returns where the overlay shows each neighbour of `ego` that is outside the viewport `view` reads. */
export function placeOffscreen(ego: TEgoGraph, view: TEgoView): TEgoPlaced[] {
	const { center, neighbours } = ego;
	const placed = neighbours.flatMap((n, i): TEgoPlaced[] => {
		if (within(view.project(n.node), 1)) return [];
		const crossing = crossingOf(n, center, view);
		const u = crossing >= EGO_MIN_CROSSING ? crossing : 1;
		const d = minus(n.node, center);
		const pos = u === crossing ? pointAlongLink(center, n.node, n.direction, u) : marginPoint(center, dot(d, view.basis.right), dot(d, view.basis.up), i / neighbours.length, view);
		const spokePoints = spokeOf(n, center, u);
		spokePoints[spokePoints.length - 1] = pos;
		return [{ ...n, pos, predicatePos: pointAlongLink(center, n.node, n.direction, u / 2), spokePoints }];
	});
	relax(placed, center, view);
	return placed;
}
