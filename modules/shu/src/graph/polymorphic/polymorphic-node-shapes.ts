/**
 * The polymorphic PAINT: translates a backend-neutral NodeMark (produced by a per-@type presenter) into a three.js object,
 * one builder per mark kind, dispatched by paintMarkScene. The SVG paint shares the SAME per-@type presenter, so a
 * data node's COLOUR can't drift between the two renders; the per-kind shape geometry (chip/box/image) is 3D-only today.
 * The mark carries the semantics (kind, label, colour, box length); the deps carry only the medium config (the THREE
 * namespace, a label factory, the theme text colours, the rendering constants), all injected so the geometry:
 * positions + dimensions, which are just numbers, is unit-tested with a recording stub, not a GPU.
 */
import type { NodeMark } from "../graph-scene.js";
import { GANTT_BAR_H, GANTT_BAR_D, GANTT_MIN_BAR_W, GANTT_LABEL_INSET } from "../gantt-layout.js";
import { chipTextHeight } from "./layout-forces.js";

type V3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
type Obj3D = { position: V3; scale: V3; renderOrder: number; add(o: Obj3D): void };
type Mat = { depthTest: boolean; depthWrite: boolean };
type SpriteObj = Obj3D & { center: { set(x: number, y: number): void }; material: Mat };
/** The label surface this factory drives: the slice of a SpriteText (or its test stub) the shapes set. */
export type ShapeLabel = Obj3D & {
	material: Mat;
	/** The billboard anchor, readable as well as settable: a sprite's center is a vector, and a caller checking where a chip sits reads it. */
	center: { x: number; y: number; set(x: number, y: number): void };
	fontSize: number;
	fontWeight: string;
	backgroundColor: string | false;
	borderColor: string;
	borderWidth: number;
	borderRadius: number;
	padding: number[];
};
/** The slice of THREE the shapes construct (the scene's own AFRAME.THREE at runtime, a stub in tests). */
export type ShapeThree = {
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	BoxGeometry: new (w: number, h: number, d: number) => unknown;
	MeshBasicMaterial: new (params: Record<string, unknown>) => unknown;
};
export type NodeShapeDeps = {
	three: ShapeThree | undefined; // undefined off-GPU (headless) → chip fallback
	makeLabel: (text: string, height: number, color: string) => ShapeLabel;
	textColor: string; // text ON a chip (over the light type-colour fill), dark in both themes
	sceneTextColor: string; // text OFF a chip, on the scene background (the box label), foreground colour
	borderColor: string;
	fontSize: number;
	renderOrder: number;
	headerLabel?: boolean; // a box mark's label sits upright, centred above the bar's start face: a sequence participant's name over its vertical lifeline
};

/** A type-coloured label chip billboard, CENTRED on the node position: the shared builder for the default instance chip
 *  and the square schema-Class token (`radius` = corner rounding, `bold` = weight). Centring (not left-anchoring) is
 *  deliberate: the focus magnifier scales the sprite about its anchor, so a centred chip grows IN PLACE instead of
 *  ballooning sideways out of a clump; it also makes collideRadius (a node-centred circle) an accurate half-width. */
function labelChip(mark: NodeMark, d: NodeShapeDeps, radius: number, bold: boolean): Obj3D {
	const s = d.makeLabel(mark.label, chipTextHeight(mark), d.textColor);
	s.fontWeight = bold ? "bold" : "normal";
	s.fontSize = d.fontSize;
	s.backgroundColor = mark.color;
	s.borderColor = d.borderColor;
	s.borderWidth = mark.isCluster ? 1 : 0.5;
	s.borderRadius = radius;
	s.padding = mark.isCluster ? [2, 6] : [3, 2];
	s.center.set(0.5, 0.5);
	s.renderOrder = d.renderOrder;
	s.material.depthTest = false;
	s.material.depthWrite = false;
	return s;
}

/** The default instance chip: type-coloured, rounded (a cluster reads as a bold pill). */
export function chipShape(mark: NodeMark, d: NodeShapeDeps): Obj3D {
	return labelChip(mark, d, mark.isCluster ? 50 : 2, mark.isCluster ?? false);
}

/** The merged ontology's Class token: a solid SQUARE chip (sharp corners + bold), set apart from the rounded instances. */
export function squareShape(mark: NodeMark, d: NodeShapeDeps): Obj3D {
	return labelChip(mark, d, 0, true);
}

/** A type-coloured 3D duration box spanning z by mark.zExtent, with a plain text label at its start face. Falls back to
 *  the chip when no THREE is available (headless). */
export function boxShape(mark: NodeMark, d: NodeShapeDeps): Obj3D {
	if (!d.three) return chipShape(mark, d);
	const zLen = Math.max(mark.zExtent ?? 0, GANTT_MIN_BAR_W);
	// Time is the z axis: the box spans z by its duration (thin on x = depth, GANTT_BAR_H tall on y = its lane).
	const box = new d.three.Mesh(new d.three.BoxGeometry(GANTT_BAR_D, GANTT_BAR_H, zLen), new d.three.MeshBasicMaterial({ color: mark.color, transparent: true, depthWrite: false }));
	box.renderOrder = d.renderOrder;
	// The bar label is plain text that overflows a short bar onto the dark scene, use the scene foreground, not the
	// on-chip dark text, so it reads (white on black in dark mode) instead of vanishing black-on-black.
	const label = d.makeLabel(mark.label, chipTextHeight(mark), d.sceneTextColor);
	label.fontSize = d.fontSize;
	label.renderOrder = d.renderOrder;
	label.material.depthTest = false;
	label.material.depthWrite = false;
	// A sequence participant's name is an upright HEADER centred above its vertical lifeline (screen-up is earliest-z
	// there), as a sequence diagram reads. A billboard sprite never rotates, so the name stays legible from any orbit:
	// the old screen-space quarter-turn only lined up with the bars at the canonical aim and read down the bar besides.
	if (d.headerLabel) {
		label.center.set(0.5, 0); // bottom-centre anchor → the text caps the bar
		label.position.set(0, 0, -zLen / 2); // at the bar's start (earliest-z) face: the lifeline's top on screen
	} else {
		label.center.set(0, 0.5); // read along the bar from its start face (a gantt row)
		label.position.set(0, 0, -zLen / 2 + GANTT_LABEL_INSET);
	}
	box.add(label);
	return box;
}

/** The merged ontology's Property (predicate) as an elongated diamond / lozenge: a solid token, the name centred, the
 *  ends drawn to points: a relation reads as a distinct SHAPE, not a chip. A canvas-textured billboard (always faces the
 *  camera, sized so the name matches a chip's text height); off-GPU (headless) it falls back to a chip. */
export function lozengeShape(mark: NodeMark, d: NodeShapeDeps): Obj3D {
	const T = d.three as unknown as
		| (ShapeThree & { Sprite: new (m: unknown) => SpriteObj; SpriteMaterial: new (p: Record<string, unknown>) => unknown; CanvasTexture: new (c: unknown) => unknown })
		| undefined;
	if (!T || typeof document === "undefined") return chipShape(mark, d);
	const font = 64; // canvas-space font; the sprite scale below maps the text back to chipTextHeight world units
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	ctx.font = `bold ${font}px sans-serif`;
	const padX = font * 0.35,
		padY = font * 0.22;
	const rectW = ctx.measureText(mark.label).width + 2 * padX; // the flat middle that holds the name
	const h = font + 2 * padY;
	const cap = h * 0.55; // the pointed left/right ends: the "diamond"
	const w = rectW + 2 * cap;
	canvas.width = Math.ceil(w);
	canvas.height = Math.ceil(h);
	ctx.font = `bold ${font}px sans-serif`; // resizing the canvas reset the 2D context state
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.beginPath();
	ctx.moveTo(0, h / 2);
	ctx.lineTo(cap, 0);
	ctx.lineTo(cap + rectW, 0);
	ctx.lineTo(w, h / 2);
	ctx.lineTo(cap + rectW, h);
	ctx.lineTo(cap, h);
	ctx.closePath();
	ctx.fillStyle = mark.color;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = d.borderColor;
	ctx.stroke();
	ctx.fillStyle = d.textColor;
	ctx.fillText(mark.label, w / 2, h / 2 + font * 0.05);
	const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), transparent: true, opacity: mark.faint ? 0.4 : 1, depthTest: false, depthWrite: false }));
	const worldH = chipTextHeight(mark) * (h / font); // scale so the NAME renders at the same world height as a chip's text
	sprite.scale.set(worldH * (w / h), worldH, 1);
	sprite.center.set(0.5, 0.5);
	sprite.renderOrder = d.renderOrder;
	sprite.material.depthTest = false;
	sprite.material.depthWrite = false;
	return sprite;
}

/** Translate a backend-neutral NodeMark into a polymorphic three.js object: one builder per kind. Unimplemented kinds
 *  throw (fail-fast) rather than rendering nothing; the SVG paint mirrors this dispatch for the same marks. */
export function paintMarkScene(mark: NodeMark, d: NodeShapeDeps): Obj3D {
	switch (mark.kind) {
		case "chip":
			return chipShape(mark, d);
		case "square":
			return squareShape(mark, d);
		case "lozenge":
			return lozengeShape(mark, d);
		case "box":
			return boxShape(mark, d);
		case "image":
		case "mesh":
		case "marker":
			throw new Error(`polymorphic paint: mark kind "${mark.kind}" not implemented yet`);
		default:
			throw new Error(`polymorphic paint: unknown mark kind "${(mark as { kind: string }).kind}"`);
	}
}
