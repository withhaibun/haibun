/**
 * Graph layout physics as pure d3-force config: the charge/collide/link constants and the sprite-sized collision
 * force. The same forces register on a paint's live simulation and on a raw forceSimulation, so layout stability is
 * one source of truth (e.g. "feeding a new node must not move the existing ones").
 */
import { forceCollide } from "d3-force-3d";
import { ellipsize } from "@haibun/core/lib/util/index.js";

export const CHARGE = -90;
export const GROUPED_CHARGE = -45;
// Ungrouped, a gentle pull toward the origin so the layout can't grow without bound: disconnected nodes (no links, no
// group cohesion) would otherwise repel each other off-frame forever. Weak enough not to distort connected structure,
// strong enough to keep the whole graph within a fixed camera — so the view never has to chase it by zooming.
export const CONTAIN_STRENGTH = 0.05;
export const GROUPED_LINK_STRENGTH = 0.02; // while grouped, links are context lines, not springs — cohesion owns positions
// Link rest length: long enough to clear both endpoints' labels (their collide half-widths) plus a small gap, so the
// spring's target matches the collision instead of fighting it — connected nodes settle close and edges read short.
// Unset, d3-force-3d defaults to a fixed 30, shorter than wide labels, so charge/collision win and edges stretch long.
export const LINK_DISTANCE_PAD = 24;
// A pinned view places nodes at fixed targets (gantt calendar slots, sequence lanes, the td/lr layered flow). The
// positional pull is strong (like cohesion) so a node holds its slot; the ghost-tween glides common nodes there on a
// view-type change.
export const PINNED_STRENGTH = 0.35; // the positional-force strength a pinned view holds nodes at (a polymorphic tuning; the gantt SIZING consts live in @haibun/shu/graph/gantt-layout)
// World-unit gaps the layered (td/lr) solver leaves between ranks (flow axis) and between siblings (cross axis).
export const LAYERED_RANK_GAP = 40;
export const LAYERED_SIBLING_GAP = 16;
export const COLLIDE_STRENGTH = 0.9;
export const ALPHA_DECAY = 0.06;
export const VELOCITY_DECAY = 0.5;
/** Text and strokes on a node chip — dark on the light type-colour fill, shared with the SVG still so the two media cannot drift. */
export const NODE_TEXT_COLOR = "#1a1a1a";

export type LayoutNode = { name: string; isCluster?: boolean };

/** The chip's text height in world units — shared by sprite construction, the collision force, and readable-scale math. */
export const chipTextHeight = (n: { isCluster?: boolean }): number => (n.isCluster ? 4 : 3);

/** Labels longer than this are truncated for the chip text, so a long base64 @id (status list, multibase key, embedded
 *  JSON) can't render as a hundreds-of-units-wide chip that blows up both the layered cross-axis and the grouped
 *  footprint. The same cap bounds collideRadius below so the collision half-width agrees with the truncated chip. */
export const MAX_LABEL_CHARS = 64;

/** Bound a chip/node label to MAX_LABEL_CHARS with an ellipsis — the ONE place a long id (status list, multibase key,
 *  embedded JSON) is shortened for display, so the chip's world width stays bounded and agrees with collideRadius. */
export const truncateLabel = (s: string): string => ellipsize(s, MAX_LABEL_CHARS);

/** Approximate the SpriteText billboard's half-width so the collision force keeps labels from overlapping. Bounded by
 *  MAX_LABEL_CHARS: past the cap the chip text is truncated, so the half-width stops growing with the raw label length. */
export const collideRadius = (n: LayoutNode): number => {
	const h = chipTextHeight(n);
	return h * 0.6 + Math.min(n.name.length, MAX_LABEL_CHARS) * h * 0.28;
};

/** Sprite-sized collision force — the exact force the browser sim and a headless test both register. */
export const collideForce = () =>
	forceCollide()
		.radius((n: unknown) => collideRadius(n as LayoutNode))
		.strength(COLLIDE_STRENGTH);
