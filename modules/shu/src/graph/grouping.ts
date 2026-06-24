/**
 * Graph grouping + layout-transition geometry: the grouping key, cohesion tuning, the bounding-box math, and the
 * transition easing. Each paint maps these to its own rendering constants (opacity, render order, etc.).
 */

import { LinkRelations, roleRels } from "@haibun/core/lib/resources.js";
import { HYPERMEDIA_ROLE_KEY } from "../graph-model.js";

export type XYZ = { x: number; y: number; z: number };

/** Grouping/container axis: by `@type` (today's default) or by `HypermediaRole` (the party a node is attributed to). */
export type GroupKeyMode = "type" | "role";

/** Container bucket for a node with no resolved HypermediaRole, under the role axis. */
export const UNATTRIBUTED_ROLE = "(unattributed)";

/** PRIORITY POLICY (a VIEW policy, not an ontology fact): when a node carries SEVERAL role edges, which one names its
 *  container/lane. An artifact published to a verifiable data registry groups under that registry (registeredIn) — this
 *  outranks its controller, so the issuer's published key/status-list sit in the registry container, not the issuer's.
 *  A VerifiablePresentation groups with its holder (cred:holder); a bare VerifiableCredential with its issuer
 *  (cred:issuer); a verification with its verifier (performedBy). The canonical PROV/AS attribution rels
 *  (wasAttributedTo/attributedTo) are the lowest-priority fallback for an ordinary record. A role rel NOT listed here
 *  still counts (it folds, just after every ranked one); the list only orders the ranked few. */
const ROLE_PRIORITY: readonly string[] = [
	LinkRelations.REGISTERED_IN.rel,
	LinkRelations.CREDENTIAL_HOLDER.rel,
	LinkRelations.CREDENTIAL_ISSUER.rel,
	LinkRelations.CREDENTIAL_SUBJECT.rel,
	LinkRelations.PERFORMED_BY.rel,
	LinkRelations.VERIFIER.rel,
	LinkRelations.AUTHOR.rel,
	LinkRelations.WAS_ATTRIBUTED_TO.rel,
	LinkRelations.ATTRIBUTED_TO.rel,
];

/** The role-attribution predicates (edge labels) whose target is a node's HypermediaRole, IN PRIORITY ORDER (first
 *  match wins). ONTOLOGY-DRIVEN: the SET is derived from LinkRelations — every rel declared `subPropertyOf` the broad
 *  role super-property `inRoleOf` (see resources.roleRels()) — never a hand-maintained array, so declaring a new role
 *  predicate is one `subPropertyOf: "inRoleOf"` in LinkRelations with nothing to edit here. The ORDER is the
 *  ROLE_PRIORITY view policy above for the ranked rels, then any remaining derived role rels (stable, by name). The fold
 *  matches the quad predicate = the createEdge edge label, so every entry is a genuine term. */
export const ROLE_RELS: readonly string[] = (() => {
	const derived = roleRels();
	const ranked = ROLE_PRIORITY.filter((r) => derived.has(r));
	const rest = [...derived].filter((r) => !ranked.includes(r)).sort();
	return [...ranked, ...rest];
})();

/** The group/container key for a node: its `@type` (default), or its `HypermediaRole` under the role axis. One selector,
 *  both axes — the fold in buildGraphModelFromQuads put the role on `properties[HYPERMEDIA_ROLE_KEY]`, so this stays pure. */
export const groupKeyOf = (n: { type: string; properties?: Record<string, unknown> }, mode: GroupKeyMode = "type"): string =>
	mode === "role" ? String(n.properties?.[HYPERMEDIA_ROLE_KEY] ?? UNATTRIBUTED_ROLE) : n.type;

/** The display label for a container of `key`: under the role axis, the party's own display label (resolved by id) so a
 *  container reads e.g. "Coastal Fisheries Authority", not its DID; under the type axis, the type key reads as-is. */
export const containerLabelOf = (key: string, mode: GroupKeyMode, labelById?: ReadonlyMap<string, string>): string => (mode === "role" ? (labelById?.get(key) ?? key) : key);

// Cohesion: how hard a group's members are pulled toward their ring anchor in XY (the "exclusive area" comes from
// this, not the border alone). Depth is not cohesion's to control — z maps to each object's generatedAtTime.
export const COHESION_STRENGTH = 0.6;
/** Estimated per-node XY footprint (chip + breathing room) — sizes each group's expected radius as √(count) discs. */
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

/**
 * Anchors packed to fill the plane, not a hollow ring: groups (each a disc of the given radius — an estimate
 * seeded from membership, corrected by the group's MEASURED extent once settled) are shelf-packed largest-first
 * into rows targeting a roughly square overall footprint, then centred on the origin. Adjacent discs are kept
 * `gap` apart, which is what keeps the enclosure boxes from sitting on top of each other; the square target is
 * what makes the layout use the viewport's width AND height instead of a thin annulus.
 */
export function packLayout(radii: ReadonlyMap<string, number>, gap: number): Map<string, GroupAnchor> {
	const keys = [...radii.keys()].sort((a, b) => (radii.get(b) ?? 0) - (radii.get(a) ?? 0));
	const anchors = new Map<string, GroupAnchor>();
	if (keys.length === 0) return anchors;
	if (keys.length === 1) {
		anchors.set(keys[0], { x: 0, y: 0 });
		return anchors;
	}
	const r = (k: string) => Math.max(radii.get(k) ?? 1, 1);
	const cells = keys.map((k) => 2 * r(k) + gap);
	const targetW = Math.sqrt(cells.reduce((s, c) => s + c * c, 0));
	let x = 0;
	let y = 0;
	let rowH = 0;
	for (const k of keys) {
		const cell = 2 * r(k) + gap;
		if (x > 0 && x + cell > targetW) {
			x = 0;
			y += rowH;
			rowH = 0;
		}
		anchors.set(k, { x: x + cell / 2, y: y + cell / 2 });
		x += cell;
		rowH = Math.max(rowH, cell);
	}
	// Centre the packing on the origin so the graph grows symmetrically around the camera target.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const k of keys) {
		const a = anchors.get(k);
		if (!a) continue;
		minX = Math.min(minX, a.x - r(k));
		maxX = Math.max(maxX, a.x + r(k));
		minY = Math.min(minY, a.y - r(k));
		maxY = Math.max(maxY, a.y + r(k));
	}
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	for (const [k, a] of anchors) anchors.set(k, { x: a.x - cx, y: a.y - cy });
	return anchors;
}

export type GroupBox = { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };

/** Padded axis-aligned bounding box (centre + size) of a set of positioned members; null when the set is empty.
 * `extentOf` supplies each member's own half-extents (a node CHIP is a wide billboard, not a point — bounds over
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

/** easeInOutCubic: slow-in, slow-out — a calm transition that's easy to follow. */
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
