// The fisheye graph's node/link shapes and the minimal three.js object slices they carry. Shared by the view and the
// DataPipeline subsystem so both speak the same FGNode/FGLink without a circular import through the component.

import type { TBurn } from "./polymorphic-highlight.js";

/** A scene object as this view drives it: position, scale, draw order and (where the mark has one) a material to dim
 *  through. Declared structurally so the layout, focus and pick subsystems never import a 3D library — the concrete
 *  chip and sprite implementations satisfy it. */
type V3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
export type Obj3D = {
	position: V3;
	scale: V3;
	renderOrder: number;
	quaternion?: { copy(q: unknown): void };
	material?: { opacity: number; transparent: boolean };
	children?: unknown[];
	/** Parent another object to this one, as a group does its parts. */
	add?(child: unknown): void;
	remove?(child: unknown): void;
};
/** A quaternion as read for billboard orientation. */
export type QLike = { x: number; y: number; z: number; w: number };

/**
 * A node's render object behind ONE uniform handle, so pick, billboard, focus dimming and the opacity readback never
 * branch on the object's concrete type. A glyph-atlas chip and a plain sprite each present this same face.
 */
export interface NodeVisual {
	readonly object: Obj3D; // the scene object the lib renders + the magnifier scales
	readonly pickTarget: Obj3D; // the raycast target (a chip's background quad; a sprite is itself)
	readonly hasHighlight: boolean; // wearing the active-node glow right now — the one observable tests read
	/** Wear or drop the glow that marks the ACTIVE node, `glow` carrying how it burns right now (strength and colour,
	 *  driven per frame). `hasHighlight` tracks `on` alone, so it stays true through the dimmest part of the breath. */
	setHighlighted(on: boolean, glow?: TBurn): void;
	opacity: number; // effective opacity — get for the readback, set for the focus dim
	faceCamera(q: QLike): void; // orient to the camera (a chip group; a native-billboard sprite / fixed bar is a no-op)
}

type ThreeObj = { material?: { transparent: boolean; opacity: number }; children?: ThreeObj[] };
export type { ThreeObj };

/** The slice of a SpriteText billboard this view drives (three-spritetext's d.ts omits the inherited Object3D members). */
export type TSprite = ThreeObj & {
	renderOrder: number;
	fontSize: number;
	text: string;
	color: string;
	center: { x: number; y: number; set(x: number, y: number): void };
	scale: { x: number; y: number; set(x: number, y: number, z: number): void };
	material: { transparent: boolean; opacity: number; depthTest: boolean; depthWrite: boolean };
	position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
	parent?: { renderOrder: number; children?: ThreeObj[] } | null;
	raycast?: () => void;
};

export type FGNode = {
	id: string;
	name: string;
	type: string;
	isCluster?: boolean;
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
	fx?: number; // d3 fixed-position pins — set during a layout tween to drive each node along its eased path
	fy?: number;
	fz?: number;
	__t?: number; // the z-basis time (epoch ms; see __tField for its source) — depth is the time axis: z maps to when the object happened
	/** The field __t came from (the valid-time field, or generatedAtTime on fallback/indexed basis) — the hover's unit label. */
	__tField?: string;
	/** When the record was made (generatedAtTime, epoch ms), whatever places depth — what a reading in the order things happened follows. */
	__created?: number;
	__degree?: number; // number of incident visible links — the depth value under the "# connections" z basis
	__visual?: NodeVisual; // the uniform handle for pick/billboard/focus/opacity — the one place the render object's type is known
	__sprite?: TSprite; // === __visual.object; kept typed for the magnifier, which drives scale/renderOrder/fontSize directly
	__baseScale?: { x: number; y: number }; // the sprite's intrinsic scale (SpriteText derives it from textHeight); magnify multiplies it
	__k?: number; // current magnify multiplier
	__chipText?: string; // what the chip the factory built actually says — the label-as-depth read, and the observable inspect reports
	properties?: Record<string, unknown>; // carried from the model node — incl the folded HypermediaRole that groupKeyOf(n, "role") reads
};

export type FGLink = {
	source: string | FGNode;
	target: string | FGNode;
	predicate: string;
	// Read-only handle to the lib's current line mesh, refreshed every tick in linkPositionUpdate (never cached-once,
	// so it can't go stale). The line's colour AND opacity are owned by the lib via linkColor (see lineRgbaFor); this
	// is only read — by inspect() and the behaviour tests — never mutated.
	__lineObj?: ThreeObj;
	__labelSprite?: TSprite;
	__curve?: { getPoint(t: number): { x: number; y: number; z: number } };
};

export const linkEndId = (e: string | FGNode): string => (typeof e === "string" ? e : e.id);

/** The id-set of a node plus its 1-hop neighbours (the node itself included) — every node one link away. One linear pass
 *  over the links; frames or focuses a node's local context. */
export const neighboursOf = (nodeId: string, links: Iterable<FGLink>): Set<string> => {
	const ids = new Set<string>([nodeId]);
	for (const l of links) {
		const s = linkEndId(l.source);
		const t = linkEndId(l.target);
		if (s === nodeId) ids.add(t);
		else if (t === nodeId) ids.add(s);
	}
	return ids;
};
