/**
 * Graph grouping + layout-transition geometry: the grouping key, cohesion tuning, the bounding-box math, and the
 * transition easing. Each paint maps these to its own rendering constants (opacity, render order, etc.).
 */

import { HYPERMEDIA_ROLE_KEY } from "../graph-model.js";

export type XYZ = { x: number; y: number; z: number };

/** A grouping/container axis. `"type"` groups by `@type`; `"role"` by the highest-priority actor a node is attributed to
 *  (rels-cache `roleEdgeLabels()`: ontology + concern-catalog derived, ordered by each rel's / consumer edge's DECLARED
 *  rolePriority: never a hand-kept list, and no consumer vocabulary named here); ANY other value is a merged
 *  node-property key: an actor predicate, or the read-time SITE_KEY stamp (the site whose store served the node, set at
 *  the federation merge). */
export type GroupKeyMode = "type" | "role" | (string & {});

/** Container bucket for a node with no agent at the chosen actor axis. */
export const UNATTRIBUTED_ROLE = "(unattributed)";

/** The group/container key for a node under `axis`: its `@type`, its highest-priority actor (`"role"`), or the agent at a
 *  specific actor predicate. buildGraphModelFromQuads records each actor edge on `properties[predicate]` and the winner on
 *  `properties[HYPERMEDIA_ROLE_KEY]`, so this reads a plain property either way: no edge walking, no predicate enumerated
 *  here (the axis string IS the predicate). */
export const groupKeyOf = (n: { type: string; properties?: Record<string, unknown> }, axis: GroupKeyMode = "type"): string => {
	if (axis === "type") return n.type;
	if (axis === "role") return String(n.properties?.[HYPERMEDIA_ROLE_KEY] ?? UNATTRIBUTED_ROLE);
	return String(n.properties?.[axis] ?? UNATTRIBUTED_ROLE);
};

/** The display label for a container of `key`: under any ACTOR axis (role or a specific predicate) the key is an agent id,
 *  so resolve it to that agent's own display label (e.g. "Coastal Fisheries Authority", not its DID); under the type axis
 *  the type key reads as-is. */
export const containerLabelOf = (key: string, axis: GroupKeyMode, labelById?: ReadonlyMap<string, string>): string => (axis === "type" ? key : (labelById?.get(key) ?? key));

// Cohesion: how hard a group's members are pulled toward their ring anchor in XY (the "exclusive area" comes from
// this, not the border alone). Depth is not cohesion's to control, z maps to each object's generatedAtTime.
export const COHESION_STRENGTH = 0.6;
/** Estimated per-node XY footprint (chip + breathing room), sizes each group's expected radius as √(count) discs. */
export const GROUP_SPREAD = 24;
/** Clear space between adjacent groups' estimated footprints on the ring. */
export const GROUP_GAP = 80;
/** Enclosure box margin from the outermost member, and a floor on every dimension so a flat (2D/dag) layout still yields a visible slab. */
export const ENCLOSURE_PAD = 6;
export const ENCLOSURE_MIN_THICK = 1;

export type GroupAnchor = { x: number; y: number };

/** Ring anchors for the distinct group keys, in the given order. One group sits at the origin; none ⇒ empty map. */
export function ringAnchors(keys: string[], radius: number): Map<string, GroupAnchor> {
	const anchors = new Map<string, GroupAnchor>();
	const k = keys.length;
	if (k === 1) anchors.set(keys[0], { x: 0, y: 0 });
	else for (let i = 0; i < k; i++) anchors.set(keys[i], { x: Math.cos((2 * Math.PI * i) / k) * radius, y: Math.sin((2 * Math.PI * i) / k) * radius });
	return anchors;
}

/** Clear space between members inside a container's cell: the in-cell grid pitch's breathing room. */
export const IN_CELL_GAP = 12;

/**
 * Compact deterministic placement for the grouped view's enclosures: each container is a RECTANGLE {w,h}: the real
 * chip-sized footprint of its members, shelf-packed (next-fit, decreasing height) into rows that wrap near a square
 * target width, then centred on the origin with `gap` clear space between adjacent cells. A container holding one wide
 * node becomes a wide-SHORT cell; its small HEIGHT keeps the row pitch (and so the whole layout) tight, and because the
 * sort is by height that cell sinks to a late short row instead of dominating. This replaces an isotropic-disc model
 * (r=√Σradius²) that squared a single wide chip into a giant SQUARE that shoved every container apart in both
 * axes. Pure + deterministic (a function of the map's CONTENT, independent of insertion order), so the non-overlap +
 * compactness are unit-proven. Returns each container's CENTRE, in the deterministic sort order.
 */
export function shelfPack(sizes: ReadonlyMap<string, { w: number; h: number }>, gap: number): Map<string, GroupAnchor> {
	const keys = [...sizes.keys()];
	if (keys.length === 0) return new Map();
	if (keys.length === 1) return new Map([[keys[0], { x: 0, y: 0 }]]);
	// Padded cell per container: the box plus a right/bottom margin so adjacent boxes stay `gap` apart on the advancing axis.
	const cells = keys.map((k) => {
		const s = sizes.get(k);
		const w = Math.max(s?.w ?? 1, 1);
		const h = Math.max(s?.h ?? 1, 1);
		return { k, w, h, cw: w + gap, ch: h + gap };
	});
	// Deterministic total order: tallest first (a wide-short cell sinks to a late short row), then widest, then key.
	cells.sort((a, b) => b.ch - a.ch || b.cw - a.cw || a.k.localeCompare(b.k));
	const area = cells.reduce((s, c) => s + c.cw * c.ch, 0);
	const targetW = Math.max(Math.max(...cells.map((c) => c.cw)), Math.sqrt(area)); // the widest cell always fits a row alone (no infinite wrap)
	const placed: Array<{ k: string; cx: number; cy: number; w: number; h: number }> = [];
	let x = 0;
	let y = 0;
	let rowH = 0;
	for (const c of cells) {
		if (x > 0 && x + c.cw > targetW) {
			x = 0;
			y += rowH;
			rowH = 0;
		}
		placed.push({ k: c.k, cx: x + c.w / 2, cy: y + c.h / 2, w: c.w, h: c.h }); // the box centre; the gap is the cell's right/bottom margin
		x += c.cw;
		rowH = Math.max(rowH, c.ch);
	}
	// Centre the whole packing on the origin, over each box's TRUE extent (not the padded cell).
	const minX = Math.min(...placed.map((p) => p.cx - p.w / 2));
	const maxX = Math.max(...placed.map((p) => p.cx + p.w / 2));
	const minY = Math.min(...placed.map((p) => p.cy - p.h / 2));
	const maxY = Math.max(...placed.map((p) => p.cy + p.h / 2));
	const dx = (minX + maxX) / 2;
	const dy = (minY + maxY) / 2;
	return new Map(placed.map((p) => [p.k, { x: p.cx - dx, y: p.cy - dy }]));
}

export type GroupBox = { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };

/** Padded axis-aligned bounding box (centre + size) of a set of positioned members; null when the set is empty.
 * `extentOf` supplies each member's own half-extents (a node CHIP is a wide billboard, not a point, bounds over
 * bare positions leave chips poking outside their box). */
export function groupBounds(
	members: ReadonlyArray<{ x?: number; y?: number; z?: number }>,
	pad: number,
	extentOf?: (m: { x?: number; y?: number; z?: number }) => { rx: number; ry: number },
): GroupBox | null {
	if (members.length === 0) return null;
	let minX = Infinity,
		minY = Infinity,
		minZ = Infinity,
		maxX = -Infinity,
		maxY = -Infinity,
		maxZ = -Infinity;
	for (const m of members) {
		const x = m.x ?? 0,
			y = m.y ?? 0,
			z = m.z ?? 0;
		const e = extentOf?.(m) ?? { rx: 0, ry: 0 };
		minX = Math.min(minX, x - e.rx);
		maxX = Math.max(maxX, x + e.rx);
		minY = Math.min(minY, y - e.ry);
		maxY = Math.max(maxY, y + e.ry);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	return {
		cx: (minX + maxX) / 2,
		cy: (minY + maxY) / 2,
		cz: (minZ + maxZ) / 2,
		sx: Math.max(maxX - minX + 2 * pad, ENCLOSURE_MIN_THICK),
		sy: Math.max(maxY - minY + 2 * pad, ENCLOSURE_MIN_THICK),
		sz: Math.max(maxZ - minZ + 2 * pad, ENCLOSURE_MIN_THICK),
	};
}

/** easeInOutCubic: slow-in, slow-out: a calm transition that's easy to follow. */
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
