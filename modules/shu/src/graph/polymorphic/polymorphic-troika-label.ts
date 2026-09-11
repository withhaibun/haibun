/**
 * A node's render object behind ONE uniform handle, NodeVisual, so pick, billboard, focus dimming and the opacity
 * readback never branch on the object's concrete type. Two implementations:
 *
 *  - makeTroikaChip: an SDF glyph-atlas chip (troika-three-text): a small group of a solid type-coloured background
 *    quad, an SDF text label, and a leading avatar badge carrying the type's initials. Every label shares ONE glyph
 *    atlas texture and every background shares ONE unit plane,
 *    so a chip takes a couple of small objects (a per-node material, a bit of glyph geometry against the shared atlas)
 *    instead of the per-node canvas raster + GPU texture upload three-spritetext takes (the time the profiler attributes
 *    to the per-type-limit stall). troika's Text is a Mesh (not a billboard) and its glyph alpha rides fillOpacity (a
 *    shared material.opacity does nothing), so the chip carries its own faceCamera + opacity; the geometry-less group
 *    can't be raycast, so pickTarget is the background quad.
 *  - spriteVisual: the plain sprite/mesh the other marks paint to (box, lozenge, square). It billboards natively (or is
 *    a fixed 3D bar), raycasts as itself, and dims through its material, so faceCamera is a no-op and opacity is the
 *    material's.
 *
 * troika imports its own `three`; esbuild dedupes it to the scene's single super-three instance (the same way
 * three-spritetext resolves), so a chip is an object in the A-Frame scene. The text builds async on troika's
 * worker (off the main thread), sync() kicks it off and its callback sizes the background to the measured text bounds.
 */
import { Text } from "troika-three-text";
import { GLOW_SPREAD, type GlowThree, MarkGlow, makeGlow } from "../polymorphic/polymorphic-highlight.js";
import type { NodeVisual, Obj3D } from "./polymorphic-graph-types.js";

/** A scene object this module CONSTRUCTS or parents onto: the structural handle leaves `add` optional because a
 *  mark that parents nothing never needs it. */
type Group3D = Obj3D & { add(child: unknown): void };

/** The uniform handle the view holds for a node's render object (FGNode.__visual). Every subsystem that used to reach
 *  into the concrete object, pick, billboard, focus dim, inspect, goes through this instead, so the object's type
 *  (a troika chip group vs a sprite/mesh) is known in exactly one place: whichever factory built it. */
/** The slice of the scene's THREE a chip's background + highlight need, passed in (never a separately imported three). */
export type ChipThree = GlowThree & {
	Group: new () => Obj3D;
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	PlaneGeometry: new (w: number, h: number) => unknown;
	MeshBasicMaterial: new (params: Record<string, unknown>) => { opacity: number; transparent: boolean };
};

export type ChipDeps = {
	fontSize: number; // world height of the glyphs
	renderOrder: number;
	textColor: string; // dark, on the light type-colour background (as the three-spritetext chip)
	borderColor: string; // the chip's own edge, so a pale type colour still has a shape against a light page
	highlightColor: string; // the colour the active-node glow is drawn in when the chip wears one (setHighlighted)
	avatar?: string; // the type's initials, badged at the chip's leading edge; absent for a chip with no type to show
};
/** Background padding around the measured text, in fontSize units. */
const PAD_X = 0.55;
const PAD_Y = 0.32;
/** Avatar badge: padding either side of the initials, and the gap between the badge and the label, in fontSize units. */
const AVATAR_PAD_X = 0.3;
const AVATAR_GAP = 0.22;
/** Black on white: the badge is painted as a pair, so it holds its contrast against any type colour and under either
 *  theme (every light token flips dark in the dark theme). */
const AVATAR_BG_COLOR = "#ffffff";
const AVATAR_TEXT_COLOR = "#000000";
/** The chip's edge, in fontSize units, drawn beyond the background on every side. */
const BORDER_WIDTH = 0.045;
/** A hair of background beyond the node's point on the top-left, so a raycast AT the exact anchor point lands just inside
 *  the quad (a ray at the precise corner is numerically unstable → misses). Imperceptible; the text still starts on the point. */
const PICK_MARGIN = 0.12;

/** One unit plane shared by every chip background (each chip scales it; the geometry is never rebuilt). */
let sharedPlane: unknown;

/** Where the label starts, given the measured width of the avatar's initials: the badge plus the gap after it. */
export const avatarLeadX = (initialsWidth: number, fontSize: number): number => initialsWidth + fontSize * (AVATAR_PAD_X * 2 + AVATAR_GAP);

/** A chip's quads, in the group's own space where the node's point is the origin. Sizes and positions are just numbers,
 *  so the layout is unit-tested without a GPU. `leadX` is 0 for a chip with no avatar; the badge spans the chip's left
 *  edge up to the gap before the label. */
export type ChipGeometry = { w: number; h: number; cx: number; cy: number; badge?: { w: number; cx: number }; border: { w: number; h: number }; glow: { w: number; h: number } };

export function chipGeometry(textBounds: readonly [number, number, number, number], leadX: number, fontSize: number): ChipGeometry {
	const [minX, minY, maxX, maxY] = textBounds; // anchorX left, anchorY top → minX ≈ 0, maxY ≈ 0 (the text's own origin)
	const margin = fontSize * PICK_MARGIN;
	const w = leadX + (maxX - minX) + fontSize * PAD_X + margin; // avatar + text width + right pad + left margin
	const h = maxY - minY + fontSize * PAD_Y + margin; // text height + bottom pad + top margin
	const badgeW = leadX > 0 ? leadX - fontSize * AVATAR_GAP + margin : undefined;
	return {
		w,
		h,
		cx: -margin + w / 2,
		cy: margin - h / 2,
		...(badgeW !== undefined ? { badge: { w: badgeW, cx: -margin + badgeW / 2 } } : {}),
		// The chip's edge: a hairline beyond the background on every side. A type colour is a light pastel, so on the
		// light theme a chip and the page are near the same value, without an edge the chip has no shape at all.
		border: { w: w + fontSize * BORDER_WIDTH * 2, h: h + fontSize * BORDER_WIDTH * 2 },
		// The glow reaches past the chip by a share of its HEIGHT on every side (not its width), so a long label glows
		// as thickly as a short one: a width-proportional reach would smear a wide chip and pinch a narrow one.
		glow: { w: w + h * GLOW_SPREAD, h: h * (1 + GLOW_SPREAD) },
	};
}

/** Build a chip visual: a solid type-coloured background quad behind an avatar badge and an SDF text label, the node's
 *  exact point at the chip's TOP-LEFT corner (content flows right + down, so the point stays eyeball-able against the
 *  axes). sync() builds the SDF on troika's worker and, when done, sizes the background to the measured content. */
export function makeTroikaChip(label: string, bgColor: string, three: ChipThree, d: ChipDeps): NodeVisual {
	if (!sharedPlane) sharedPlane = new three.PlaneGeometry(1, 1);
	const group = new three.Group() as Group3D;

	const borderMaterial = new three.MeshBasicMaterial({ color: d.borderColor, transparent: true, depthTest: false, depthWrite: false });
	const border = new three.Mesh(sharedPlane, borderMaterial);
	border.renderOrder = d.renderOrder; // behind the background, which draws over its middle, leaving the hairline edge
	const bgMaterial = new three.MeshBasicMaterial({ color: bgColor, transparent: true, depthTest: false, depthWrite: false });
	const bg = new three.Mesh(sharedPlane, bgMaterial);
	bg.renderOrder = d.renderOrder + 1;

	// The chip's glow sizes to its measured box, which the async text layout supplies; a glow built before that sizes
	// itself on the next layout.
	let box: { w: number; h: number; cx: number; cy: number } | undefined;
	const glow = new MarkGlow(
		() => {
			const g = makeGlow(three, d.highlightColor, d.renderOrder - 1); // behind the chip body
			group.add(g);
			return g;
		},
		(g, swell) => {
			if (!box) return;
			g.scale.set(box.w * swell, box.h * swell, 1);
			g.position.set(box.cx, box.cy, 0);
		},
	);

	const makeText = (content: string, color: string, renderOrder: number) => {
		const t = new Text();
		t.text = content;
		t.fontSize = d.fontSize;
		t.color = color;
		t.anchorX = "left"; // the node's exact point is the chip's TOP-LEFT corner, content flows right and down, so the
		t.anchorY = "top"; //  point stays eyeball-able against the axes; centring (either way) buries it mid-chip
		t.renderOrder = renderOrder;
		const mat = t.material as { depthTest?: boolean; depthWrite?: boolean };
		mat.depthTest = false;
		mat.depthWrite = false;
		return t;
	};

	const text = makeText(label, d.textColor, d.renderOrder + 2);

	// The badge sets itself apart by its surface alone, a plain block beside the type-coloured body, so the initials keep
	// the label's own dark colour and need no second colour per type.
	const avatarText = d.avatar ? makeText(d.avatar, AVATAR_TEXT_COLOR, d.renderOrder + 3) : undefined;
	let avatarBg: Obj3D | undefined;
	if (avatarText) {
		const avatarMaterial = new three.MeshBasicMaterial({ color: AVATAR_BG_COLOR, transparent: true, depthTest: false, depthWrite: false });
		avatarBg = new three.Mesh(sharedPlane, avatarMaterial) as unknown as Obj3D;
		avatarBg.renderOrder = d.renderOrder + 1; // over the chip background, under both texts
	}

	group.add(border);
	group.add(bg);
	if (avatarBg) group.add(avatarBg);
	group.add(text);
	if (avatarText) group.add(avatarText as unknown as Obj3D);

	const boundsOf = (t: Text): [number, number, number, number] | undefined =>
		(t as unknown as { textRenderInfo?: { blockBounds: [number, number, number, number] } }).textRenderInfo?.blockBounds;

	// The chip's TOP-LEFT corner sits (all but exactly) at the node's point: a hair of pick margin up-and-left so the
	// anchor point is pickable, real padding on the right and bottom. The chip extends right + down, never straddling
	// the point; its leading content starts exactly on it, so the visible date is the top-left.
	//
	// Runs on EVERY measurement that lands, laying out from whatever is measured so far: the label's own build is never
	// gated on the avatar's, so a chip whose badge is slow (or never measures) still draws its whole body. The badge is
	// held at zero size until its own measurement arrives, so it never flashes at the unit plane's size.
	const layout = () => {
		const labelBounds = boundsOf(text);
		if (!labelBounds) return;
		const initials = avatarText ? boundsOf(avatarText) : undefined;
		const leadX = initials ? avatarLeadX(initials[2] - initials[0], d.fontSize) : 0;
		text.position.x = leadX;
		const g = chipGeometry(labelBounds, leadX, d.fontSize);
		bg.scale.set(g.w, g.h, 1);
		bg.position.set(g.cx, g.cy, 0);
		border.scale.set(g.border.w, g.border.h, 1);
		border.position.set(g.cx, g.cy, 0);
		if (avatarBg && g.badge) {
			avatarBg.scale.set(g.badge.w, g.h, 1);
			avatarBg.position.set(g.badge.cx, g.cy, 0);
		}
		box = { w: g.glow.w, h: g.glow.h, cx: g.cx, cy: g.cy };
		if (glow.isLit) glow.set(true);
	};

	if (avatarText) {
		avatarText.position.x = d.fontSize * AVATAR_PAD_X;
		avatarBg?.scale.set(0, 0, 1);
		avatarText.sync(layout);
	}
	text.sync(layout);

	return {
		object: group,
		pickTarget: bg,
		get hasHighlight() {
			return glow.isLit;
		},
		setHighlighted: (on, burn) => glow.set(on, burn),
		get opacity() {
			return text.fillOpacity ?? 1;
		},
		set opacity(o: number) {
			borderMaterial.opacity = o;
			text.fillOpacity = o;
			text.outlineOpacity = o; // troika drives the glyph alpha from fill/outline, not the material
			if (avatarText) {
				avatarText.fillOpacity = o;
				avatarText.outlineOpacity = o;
			}
		},
		faceCamera(q) {
			group.quaternion?.copy(q); // a Mesh group does not billboard on its own, orient it each frame
		},
	};
}

/** Wrap a plain sprite/mesh (the non-chip marks) as a NodeVisual: it raycasts as itself, dims through its material, and
 *  billboards natively (a sprite) or is a fixed 3D bar, so faceCamera is a no-op. `highlight` supplies the THREE slice
 *  and colour the active-node glow is built from; the glow rides as a child of the mark, so it sizes with it (the focus
 *  magnifier scales the parent) and works for a painted mark exactly as for a chip. */
export function spriteVisual(obj: Obj3D, highlight: { three: GlowThree; color: string; renderOrder: number }): NodeVisual {
	const glow = new MarkGlow(
		() => {
			const g = makeGlow(highlight.three, highlight.color, highlight.renderOrder);
			(obj as Group3D).add(g);
			return g;
		},
		// The reach is a share of the mark's SMALLER side, the same rule a chip's glow follows, and each axis divides out
		// the parent's own size, since a child's scale multiplies its parent's. The halo is then the same thickness on
		// all four sides whatever shape the mark is, and stays so while the magnifier scales it.
		(g, swell) => {
			const sx = Math.abs(obj.scale.x) || 1;
			const sy = Math.abs(obj.scale.y) || 1;
			const reach = Math.min(sx, sy) * GLOW_SPREAD * swell;
			g.scale.set((sx + 2 * reach) / sx, (sy + 2 * reach) / sy, 1);
		},
	);
	return {
		object: obj,
		pickTarget: obj,
		get hasHighlight() {
			return glow.isLit;
		},
		setHighlighted: (on, burn) => glow.set(on, burn),
		get opacity() {
			return obj.material?.opacity ?? 1;
		},
		set opacity(o: number) {
			if (obj.material) {
				obj.material.transparent = true;
				obj.material.opacity = o;
			}
		},
		faceCamera() {
			/* a native-billboard sprite / fixed bar orients itself: nothing to do */
		},
	};
}
