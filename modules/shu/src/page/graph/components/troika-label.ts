/// <reference path="./troika-three-text.d.ts" />
/**
 * troika draws every label of the graph (SH28). A node's render object is behind ONE uniform handle, NodeVisual, so pick,
 * billboard, focus dimming and the opacity readback never branch on the object's concrete type. Two implementations:
 *
 *  - makeTroikaChip: an SDF glyph-atlas chip (troika-three-text): a small group of a solid type-coloured background
 *    quad, an SDF text label, and a leading avatar badge carrying the type's initials. Every label shares ONE glyph
 *    atlas texture and every background shares ONE unit plane,
 *    so a chip takes a couple of small objects (a per-node material, a bit of glyph geometry against the shared atlas)
 *    instead of a per-node canvas raster and GPU texture upload. troika's Text is a Mesh (not a billboard) and its glyph alpha rides fillOpacity (a
 *    shared material.opacity doesn't affect it), so the chip carries its own faceCamera + opacity; the geometry-less group
 *    can't be raycast, so pickTarget is the background quad.
 *  - spriteVisual: the plain sprite/mesh the other marks paint to (box, lozenge). It billboards natively (or is a fixed
 *    3D bar), raycasts as itself, and dims through its material, so faceCamera turns only its labels and opacity is the
 *    material's.
 *
 * makeTroikaText draws a plain label (an edge's predicate, a group's title, a gantt date) the same way.
 *
 * troika imports its own `three`; esbuild dedupes it to the scene's single super-three instance, so a chip is an object in the A-Frame scene. The text builds async on troika's
 * worker (off the main thread), sync() kicks it off and its callback sizes the background to the measured text bounds.
 */
import { Text, configureTextBuilder } from "troika-three-text";
import { LABEL_FONT } from "../../../domains/serving.js";
import type { TCarriedLabelFont } from "../../../domains/hydration.js";
import { UNCOVERED_FLAGS, coveredText } from "../../../derivations/carried-label-font.js";
import { FULL_BURN, GLOW_SPREAD, type GlowThree, MarkGlow, makeGlow } from "../derivations/highlight.js";
import type { LabelVisual, NodeVisual, Obj3D } from "../domains/graph-types.js";

/** The font of a page's labels. A served page reads the font shu serves beside its bundles, and troika looks up a character
 *  that font lacks at `fallbacks`, an absolute address, since troika reads it in a worker. A page that carries a record of
 *  actuality opens from a file, where the two addresses don't resolve, so it holds the font as a data URL with the pattern
 *  of the characters the font lacks. */
export type TLabelFonts = { fallbacks: string } | TCarriedLabelFont;

/** The pattern of the characters the carried font lacks, or undefined on a served page, whose site serves troika's lookup
 *  of each such character. */
let carriedUncovered: RegExp | undefined;

/** Sets the font of every label, so the page draws its labels without a font service (CA3D10). troika's configuration holds
 *  for the page, so the scene sets it before it draws a label. */
export function configureLabelFonts(fonts: TLabelFonts): void {
	const served = "fallbacks" in fonts;
	carriedUncovered = served ? undefined : new RegExp(fonts.uncovered, UNCOVERED_FLAGS);
	configureTextBuilder(served ? { defaultFontURL: LABEL_FONT, unicodeFontsURL: fonts.fallbacks } : { defaultFontURL: fonts.font });
}

/** Returns `content` as troika draws it: on a page that carries its font, with each character the font lacks replaced. */
const drawnText = (content: string): string => (carriedUncovered === undefined ? content : coveredText(content, carriedUncovered));

/** Where a label's text stands against its position. */
export type TTextAnchor = { x: "left" | "center" | "right"; y: "top" | "middle" | "bottom" };

/** A chip's text starts at the node's point, its top-left corner, and flows right and down, so the point stays visible
 *  against the axes. A centred anchor places the point inside the chip. */
const CHIP_ANCHOR: TTextAnchor = { x: "left", y: "top" };

/** Returns troika's SDF text of `content` in `color`, `fontSize` world units tall, standing at `anchor` against its position,
 *  drawn over the scene without depth. */
function depthlessText(content: string, d: { fontSize: number; color: string; renderOrder: number; anchor: TTextAnchor }): Text {
	const t = new Text();
	t.text = drawnText(content);
	t.fontSize = d.fontSize;
	t.color = d.color;
	t.anchorX = d.anchor.x;
	t.anchorY = d.anchor.y;
	t.renderOrder = d.renderOrder;
	const mat = t.material as { depthTest?: boolean; depthWrite?: boolean };
	mat.depthTest = false;
	mat.depthWrite = false;
	return t;
}

/** A scene object this module CONSTRUCTS or parents onto: the structural handle leaves `add` optional because a
 *  mark that doesn't parent a child never needs it. */
type Group3D = Obj3D & { add(child: unknown): void };

/** The uniform handle the view holds for a node's render object (FGNode.__visual). Every subsystem that used to reach
 *  into the concrete object, pick, billboard, focus dim, inspect, uses this instead, so the object's type
 *  (a troika chip group vs a sprite/mesh) is named in exactly one place: whichever factory built it. */
/** The slice of the scene's THREE a chip's background + highlight need, passed in (never a separately imported three). */
export type ChipThree = GlowThree & {
	Group: new () => Obj3D;
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	PlaneGeometry: new (w: number, h: number) => unknown;
	MeshBasicMaterial: new (params: Record<string, unknown>) => { opacity: number; transparent: boolean };
};

type ChipDeps = {
	fontSize: number; // world height of the glyphs
	renderOrder: number;
	textColor: string; // dark, on the light type-colour background (the chip's text)
	borderColor: string; // the chip's own edge, so a pale type colour still has a shape against a light page
	highlightColor: string; // the colour the active-node glow is drawn in when the chip wears one (setHighlighted)
	avatar?: string; // the type's initials, badged at the chip's leading edge; absent for a chip without a type to show
	laidOut: () => void; // called each time the chip is laid out from measured text, which arrives off the main thread, so a resting scene draws it
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
 *  so the layout is unit-tested without a GPU. `leadX` is 0 for a chip without an avatar; the badge spans the chip's left
 *  edge up to the gap before the label. */
type ChipGeometry = { w: number; h: number; cx: number; cy: number; badge?: { w: number; cx: number }; border: { w: number; h: number }; glow: { w: number; h: number } };

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
		// light theme a chip and the page are near the same value, without an edge the chip doesn't have a shape at all.
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

	const makeText = (content: string, color: string, renderOrder: number) => depthlessText(content, { fontSize: d.fontSize, color, renderOrder, anchor: CHIP_ANCHOR });

	const text = makeText(label, d.textColor, d.renderOrder + 2);

	// The badge sets itself apart by its surface alone, a plain block beside the type-coloured body, so the initials keep
	// the label's own dark colour and don't need a second colour per type.
	const avatarText = d.avatar ? makeText(d.avatar, AVATAR_TEXT_COLOR, d.renderOrder + 3) : undefined;
	let avatarBg: Obj3D | undefined;
	if (avatarText) {
		const avatarMaterial = new three.MeshBasicMaterial({ color: AVATAR_BG_COLOR, transparent: true, depthTest: false, depthWrite: false });
		avatarBg = new three.Mesh(sharedPlane, avatarMaterial);
		avatarBg.renderOrder = d.renderOrder + 1; // over the chip background, under both texts
	}

	group.add(border);
	group.add(bg);
	if (avatarBg) group.add(avatarBg);
	group.add(text);
	if (avatarText) group.add(avatarText);

	const boundsOf = (t: Text): [number, number, number, number] | undefined => t.textRenderInfo?.blockBounds;

	// The chip's TOP-LEFT corner lies (all but exactly) at the node's point: a hair of pick margin up-and-left so the
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
		if (glow.isLit) glow.set(true, FULL_BURN);
		d.laidOut();
	};

	let measuring = avatarText ? 2 : 1;
	const landed = () => {
		measuring--;
		layout();
	};
	if (avatarText) {
		avatarText.position.x = d.fontSize * AVATAR_PAD_X;
		avatarBg?.scale.set(0, 0, 1);
		avatarText.sync(landed);
	}
	text.sync(landed);

	return {
		object: group,
		pickTarget: bg,
		get hasHighlight() {
			return glow.isLit;
		},
		get layingOut() {
			return measuring > 0;
		},
		setHighlighted: (on, burn) => glow.set(on, burn),
		get opacity() {
			return text.fillOpacity;
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

/** Wrap a painted mark (a sprite or a mesh, the non-chip marks) as a NodeVisual: it raycasts as itself, dims through its
 *  material, and billboards natively (a sprite) or is a fixed 3D bar, so facing the camera turns only its `labels`.
 *  `highlight` supplies the THREE slice and colour the active-node glow is built from; the glow rides as a child of the
 *  mark, so it sizes with it (the focus magnifier scales the parent) and works for a painted mark exactly as for a chip. */
export function spriteVisual(painted: { object: Obj3D; labels: LabelVisual[] }, highlight: { three: GlowThree; color: string; renderOrder: number }): NodeVisual {
	const obj = painted.object;
	const material = obj.material;
	if (material === undefined) throw new Error("spriteVisual: a painted mark dims through its material, which its paint (paintMarkScene) builds");
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
			const sx = Math.abs(obj.scale.x);
			const sy = Math.abs(obj.scale.y);
			// A mark with a zero side is invisible, and so is the halo it carries; a later set sizes the halo once the mark has a size.
			if (sx === 0 || sy === 0) return;
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
		layingOut: false, // painted when built
		setHighlighted: (on, burn) => glow.set(on, burn),
		get opacity() {
			return material.opacity;
		},
		set opacity(o: number) {
			material.transparent = true;
			material.opacity = o;
		},
		faceCamera(q) {
			for (const label of painted.labels) label.faceCamera(q);
		},
	};
}

/** The outline that emphasises a label, in the label's own colour, as a share of its font size: troika reads one font, so
 *  weight is drawn rather than read from a bold face. */
const EMPHASIS_OUTLINE = "6%";

/** A plain text label: troika's SDF text in `color`, `fontSize` world units tall, standing at `anchor` against its position,
 *  drawn over the scene without depth and not picked. `emphasis` draws it heavier, as a heading. The scene turns it to the
 *  camera each frame through `faceCamera`. */
export function makeTroikaText(content: string, d: { fontSize: number; color: string; renderOrder: number; anchor: TTextAnchor; emphasis: boolean }): LabelVisual {
	let shown = content;
	const t = depthlessText(content, d);
	if (d.emphasis) {
		t.outlineWidth = EMPHASIS_OUTLINE;
		t.outlineColor = d.color;
	}
	t.raycast = () => undefined;
	t.sync();
	return {
		object: t as unknown as Obj3D,
		get text() {
			return shown;
		},
		set text(content: string) {
			if (content === shown) return;
			shown = content;
			t.text = drawnText(content);
			t.sync();
		},
		get color() {
			return String(t.color);
		},
		set color(color: string) {
			t.color = color;
			if (d.emphasis) t.outlineColor = color;
		},
		get opacity() {
			return t.fillOpacity;
		},
		set opacity(o: number) {
			t.fillOpacity = o;
			t.outlineOpacity = o; // troika drives the glyph alpha from fill and outline, not the material
		},
		get width() {
			const bounds = t.textRenderInfo?.blockBounds;
			return bounds === undefined ? 0 : bounds[2] - bounds[0];
		},
		faceCamera(q) {
			t.quaternion.copy(q);
		},
		dispose: () => t.dispose(),
	};
}
