/**
 * The polymorphic PAINT of the marks that aren't chips: translates a backend-neutral NodeMark (produced by a per-@type
 * presenter) into a three.js object, one builder per mark kind, dispatched by paintMarkScene. A chip (an instance, or a
 * schema Class's square token) is a troika chip the scene builds (`makeTroikaChip`). The mark carries the semantics (kind,
 * label, colour, box length); the deps carry only the medium config (the THREE namespace, a label factory, the theme text
 * colour, the rendering order), all injected so the geometry, positions and dimensions, is unit-tested with a recording
 * stub, not a GPU.
 */
import type { NodeMark } from "../domains/graph-scene.js";
import { GANTT_BAR_H, GANTT_BAR_D, GANTT_MIN_BAR_W, GANTT_LABEL_INSET } from "../derivations/gantt-layout.js";
import { chipTextHeight } from "../derivations/layout-forces.js";
import type { LabelVisual } from "../domains/graph-types.js";
import type { TTextAnchor } from "./troika-label.js";

type V3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
type Obj3D = { position: V3; scale: V3; renderOrder: number; add(o: Obj3D): void };
type Mat = { depthTest: boolean; depthWrite: boolean };
type SpriteObj = Obj3D & { center: { set(x: number, y: number): void }; material: Mat };
/** The slice of THREE the shapes construct (the scene's own AFRAME.THREE at runtime, a stub in tests). */
export type ShapeThree = {
	Mesh: new (geometry: unknown, material: unknown) => Obj3D;
	BoxGeometry: new (w: number, h: number, d: number) => unknown;
	MeshBasicMaterial: new (params: Record<string, unknown>) => unknown;
	Sprite: new (material: unknown) => SpriteObj;
	SpriteMaterial: new (params: Record<string, unknown>) => unknown;
	CanvasTexture: new (canvas: unknown) => unknown;
};
export type NodeShapeDeps = {
	three: ShapeThree;
	/** Builds a plain text label `height` world units tall in `color`, standing at `anchor` against its position. */
	makeLabel: (text: string, height: number, color: string, anchor: TTextAnchor) => LabelVisual;
	textColor: string; // text ON a token (over the light type-colour fill), dark in both themes
	sceneTextColor: string; // text OFF a token, on the scene background (the box label), foreground colour
	borderColor: string;
	renderOrder: number;
	headerLabel?: boolean; // a box mark's label stands upright, centred above the bar's start face: a sequence participant's name over its vertical lifeline
};

/** What a mark paints: its object, and the labels the scene turns to the camera each frame. */
export type TPainted = { object: Obj3D; labels: LabelVisual[] };

/** A type-coloured 3D duration box spanning z by mark.zExtent, with a plain text label at its start face. */
export function boxShape(mark: NodeMark, d: NodeShapeDeps): TPainted {
	if (mark.zExtent === undefined) throw new Error(`boxShape: box mark ${mark.id} lacks the zExtent its presenter supplies (assertNodeMark)`);
	const zLen = Math.max(mark.zExtent, GANTT_MIN_BAR_W);
	// Time is the z axis: the box spans z by its duration (thin on x = depth, GANTT_BAR_H tall on y = its lane).
	const box = new d.three.Mesh(new d.three.BoxGeometry(GANTT_BAR_D, GANTT_BAR_H, zLen), new d.three.MeshBasicMaterial({ color: mark.color, transparent: true, depthWrite: false }));
	box.renderOrder = d.renderOrder;
	// The bar label is plain text that overflows a short bar onto the dark scene, use the scene foreground, not the
	// on-chip dark text, so it reads (white on black in dark mode) instead of vanishing black-on-black.
	// A sequence participant's name is an upright HEADER centred above its vertical lifeline (screen-up is earliest-z
	// there), as a sequence diagram reads. The label faces the camera, so the name stays legible from any orbit.
	const label = d.makeLabel(mark.label, chipTextHeight(mark), d.sceneTextColor, d.headerLabel ? { x: "center", y: "bottom" } : { x: "left", y: "middle" });
	label.object.renderOrder = d.renderOrder;
	// At the bar's start (earliest-z) face: a header caps the lifeline's top on screen, a gantt row's label reads along the bar.
	label.object.position.set(0, 0, d.headerLabel ? -zLen / 2 : -zLen / 2 + GANTT_LABEL_INSET);
	box.add(label.object as unknown as Obj3D);
	return { object: box, labels: [label] };
}

/** The merged ontology's Property (predicate) as an elongated diamond / lozenge: a solid token, the name centred, the
 *  ends drawn to points: a relation reads as a distinct SHAPE, not a chip. A canvas-textured billboard (always faces the
 *  camera, sized so the name matches a chip's text height). */
function lozengeShape(mark: NodeMark, d: NodeShapeDeps): TPainted {
	const T = d.three;
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
	return { object: sprite, labels: [] };
}

/** Translate a backend-neutral NodeMark into a polymorphic three.js object: one builder per kind. A chip is the scene's
 *  troika chip, and unimplemented kinds throw (fail-fast) rather than rendering an empty object. */
export function paintMarkScene(mark: NodeMark, d: NodeShapeDeps): TPainted {
	switch (mark.kind) {
		case "chip":
		case "square":
			throw new Error(`polymorphic paint: a ${mark.kind} mark is a troika chip (makeTroikaChip), not a painted shape`);
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
