/**
 * EgoOverlay: the 1-hop neighbours of a hovered node that lie outside the viewport, drawn in the scene's world space. The
 * hovered node doesn't move. Each off-screen neighbour gets a virtual chip at the viewport's margin (`ego-layout.ts`), framed
 * by a dashed outline, badged `~` before its type's initials, joined to the hovered node by a dashed spoke on its edge's
 * curve, and labelled with the edge's predicate. Neighbours past `MAX_EGO_NEIGHBOURS` read as one count chip above the node.
 * The overlay fades in and out by `derivations/ego-fade.ts`, and the scene draws only while a fade runs. A neighbour inside the
 * viewport is drawn by the scene, so the overlay doesn't show the node where every neighbour is on screen.
 */
import { evaluateEgoCorridorHit, type TEgoCorridorHit, type TEgoNeighbourTarget } from "../derivations/ego-corridor.js";
import {
	approximateChipWidth,
	EGO_CHIP_HEIGHT,
	EGO_CHIP_PADDING,
	EGO_VIEWPORT_MARGIN,
	extractEgoGraph,
	placeOffscreen,
	type TEgoPlaced,
	type TEgoView,
} from "../derivations/ego-layout.js";
import { FULL_BURN } from "../derivations/highlight.js";
import { cameraBasis, ndcToClient, type TCanvasRect } from "../derivations/project.js";
import type { TSceneCamera } from "../ports.js";
import { teleportStation } from "../derivations/teleport-transition.js";
import { typeAvatar } from "../derivations/type-avatar.js";
import { EGO_HIDDEN, fadeEnded, fadeOpacity, fadeToward, type TEgoFade } from "../derivations/ego-fade.js";
import type { TWakeCause } from "../../../domains/graph-blips.js";
import type { NodeMark } from "../domains/graph-scene.js";
import type { FGLink, FGNode, LabelVisual, NodeVisual, Obj3D, XYZ } from "../domains/graph-types.js";
import { disposeGroup } from "./enclosure.js";
import { makeTroikaChip, makeTroikaText, type ChipThree } from "./troika-label.js";

export const EGO_OVERLAY_RENDER_ORDER = 800;
const CHIP_TEXT_HEIGHT = 3;
const PREDICATE_TEXT_HEIGHT = CHIP_TEXT_HEIGHT * 0.75;
/** The share of a chip's opacity, and of a spoke's, that the overlay draws at full fade. */
const CHIP_OPACITY = 0.9;
const SPOKE_OPACITY = 0.85;
/** The dashes of spokes and chip frames, in world units. */
const DASH = { dashSize: 1.8, gapSize: 1 } as const;
/** The space between a chip and its frame, and the frame's depth in front of the chip, in world units. */
const FRAME_PAD = 0.35;
const FRAME_DEPTH = 0.05;
/** The share of the chip's text height that the chip's text starts in from its point. */
const CHIP_MARGIN = CHIP_TEXT_HEIGHT * 0.12;
/** The distance from the hovered node up to the count chip, in chip heights. */
const COUNT_RISE = 2;
/** The share of its spoke past which a pointer on a spoke picks the neighbour. */
const PICK_SPOKE_SHARE = 0.6;
/** The least size of the hovered node's box and of a chip's box in the hit test, in client pixels. */
const MIN_CENTER_PX = { width: 100, height: 32 } as const;
const MIN_CHIP_PX = { width: 80, height: 28 } as const;
const VIRTUAL_BADGE = "~";

export type EgoThree = ChipThree & {
	Vector3: new () => { set(x: number, y: number, z: number): void; project(camera: unknown): { x: number; y: number; z: number } };
	BufferGeometry: new () => { setAttribute(name: string, attr: unknown): void; dispose(): void };
	Float32BufferAttribute: new (array: number[], itemSize: number) => unknown;
	LineSegments: new (g: unknown, m: unknown) => Obj3D & { computeLineDistances(): void };
	LineDashedMaterial: new (opts: Record<string, unknown>) => { opacity: number; dispose(): void };
};

export type TEgoOverlayDeps = {
	three: () => EgoThree | undefined;
	camera: () => TSceneCamera | undefined;
	/** The world length of one client pixel at a point, null until the camera is ready. */
	worldPerPxAt: (pos: XYZ) => number | null;
	parent: () => Obj3D | undefined;
	clock: { now: () => number };
	colors: () => { text: string; border: string; highlight: string; accent: string };
	markFor: (node: FGNode) => NodeMark;
	chipLabelOf: (node: FGNode, mark: NodeMark) => string;
	markDirty: (cause: TWakeCause) => void;
	/** Called where the overlay starts or stops showing, so the graph's reading states it. */
	shownChanged: () => void;
};

type TVirtual = { placed: TEgoPlaced; label: string; visual: NodeVisual; predicate: LabelVisual };

/** A shown overlay: what it was shown for, its group, its chips, its labels, the geometry it owns, and its spokes. */
type TActive = {
	center: FGNode & XYZ;
	shownFor: Parameters<EgoOverlay["show"]>;
	group: Obj3D;
	virtuals: TVirtual[];
	faced: Array<NodeVisual | LabelVisual>;
	geometries: Array<{ dispose(): void }>;
	spokes: { opacity: number } | undefined;
};

/** The overlay's chips and labels, and the hit test of its chips and spokes. */
export class EgoOverlay {
	#active: TActive | undefined;
	#fade: TEgoFade = EGO_HIDDEN;
	/** Whether a fade runs, which the scene draws. */
	#fading = false;

	constructor(private readonly deps: TEgoOverlayDeps) {}

	/** The hovered node and the neighbours the overlay shows at the margin, which the graph's reading states. */
	get shown(): { center: string; neighbours: ReadonlySet<string> } | undefined {
		const active = this.#active;
		return active === undefined ? undefined : { center: active.center.id, neighbours: new Set(active.virtuals.map(({ placed }) => placed.node.id)) };
	}

	get isVisible(): boolean {
		return this.#active !== undefined;
	}

	get fading(): boolean {
		return this.#fading;
	}

	/** The chips and labels to turn toward the camera. */
	labels(): ReadonlyArray<NodeVisual | LabelVisual> {
		return this.#active === undefined ? [] : this.#active.faced;
	}

	/** Shows the overlay for `hovered`, whose neighbours `nodeMap` and `links` state, on the canvas `rect`, and starts its fade-in. A
	 *  node it already shows keeps its overlay. A node without an off-screen neighbour, or a scene without its camera,
	 *  doesn't show it. */
	show(hovered: FGNode & XYZ, nodeMap: Map<string, FGNode>, links: readonly FGLink[], rect: TCanvasRect): void {
		if (this.#active?.center.id === hovered.id) return this.keepVisible();
		this.hideImmediate();
		const [T, camera, parent, ego] = [this.deps.three(), this.deps.camera(), this.deps.parent(), extractEgoGraph(hovered.id, nodeMap, links)];
		if (!T || !camera || !parent || !ego) return;
		const view = this.#view(T, camera, ego.center, rect);
		if (view === undefined) return;
		const placed = placeOffscreen(ego, view);
		if (placed.length === 0) return;
		const colors = this.deps.colors();
		const group = new T.Group();
		const material = new T.LineDashedMaterial({ color: colors.accent, ...DASH, transparent: true, opacity: SPOKE_OPACITY, depthWrite: false, depthTest: false });
		const geometries: Array<{ dispose(): void }> = [];
		const lines = (points: number[], renderOrder: number) => {
			const geometry = new T.BufferGeometry();
			geometries.push(geometry);
			const line = new T.LineSegments(geometry, material);
			const draw = (at: number[]): void => {
				geometry.setAttribute("position", new T.Float32BufferAttribute(at, 3));
				line.computeLineDistances();
			};
			draw(points);
			line.raycast = () => undefined;
			line.renderOrder = renderOrder;
			return { line, draw };
		};
		// A chip's frame surrounds its box: the estimate of its text's width until the measured text lands, then its
		// background's measured box.
		const frame = (w: number, h: number, cx: number, cy: number): number[] => {
			const [x1, x2, y1, y2, z] = [cx - w / 2 - FRAME_PAD, cx + w / 2 + FRAME_PAD, cy - h / 2 - FRAME_PAD, cy + h / 2 + FRAME_PAD, FRAME_DEPTH];
			return [x1, y2, z, x2, y2, z, x2, y2, z, x2, y1, z, x2, y1, z, x1, y1, z, x1, y1, z, x1, y2, z];
		};
		const chip = (text: string, color: string, avatar: string): NodeVisual => {
			const [w, h] = [approximateChipWidth(text) + EGO_CHIP_PADDING, EGO_CHIP_HEIGHT];
			const outline = lines(frame(w, h, w / 2 - CHIP_MARGIN, CHIP_MARGIN - h / 2), EGO_OVERLAY_RENDER_ORDER + 1);
			const visual: NodeVisual = makeTroikaChip(text, color, T, {
				fontSize: CHIP_TEXT_HEIGHT,
				renderOrder: EGO_OVERLAY_RENDER_ORDER + 1,
				textColor: colors.text,
				borderColor: colors.accent,
				highlightColor: colors.highlight,
				avatar,
				laidOut: () => {
					const { scale, position } = visual.pickTarget;
					outline.draw(frame(scale.x, scale.y, position.x, position.y));
					this.deps.markDirty("label");
				},
			});
			visual.pickTarget.raycast = () => undefined;
			visual.object.add?.(outline.line);
			group.add?.(visual.object);
			return visual;
		};
		const virtuals = placed.map((p): TVirtual => {
			const mark = this.deps.markFor(p.node);
			const label = this.deps.chipLabelOf(p.node, mark);
			const predicate = makeTroikaText(p.link.predicate, {
				fontSize: PREDICATE_TEXT_HEIGHT,
				color: colors.accent,
				renderOrder: EGO_OVERLAY_RENDER_ORDER + 2,
				anchor: { x: "center", y: "middle" },
				emphasis: false,
			});
			group.add?.(predicate.object);
			return { placed: p, label, visual: chip(label, mark.color, `${VIRTUAL_BADGE}${typeAvatar(mark.type)}`), predicate };
		});
		const spokePoints = placed.flatMap(({ spokePoints: s }) => s.slice(1).flatMap((b, i) => [s[i], b].flatMap((p) => (p === undefined ? [] : [p.x, p.y, p.z]))));
		const spoke = lines(spokePoints, EGO_OVERLAY_RENDER_ORDER).line;
		group.add?.(spoke);
		const rest = ego.totalNeighbours - ego.neighbours.length;
		const counted = rest > 0 ? [chip(`+${rest}`, colors.accent, VIRTUAL_BADGE)] : [];
		for (const c of counted)
			c.object.position.set(
				ego.center.x + view.basis.up.x * EGO_CHIP_HEIGHT * COUNT_RISE,
				ego.center.y + view.basis.up.y * EGO_CHIP_HEIGHT * COUNT_RISE,
				ego.center.z + view.basis.up.z * EGO_CHIP_HEIGHT * COUNT_RISE,
			);
		const faced = [...virtuals.flatMap(({ visual, predicate }) => [visual, predicate]), ...counted];
		this.#active = { center: ego.center, shownFor: [hovered, nodeMap, links, rect], group, virtuals, faced, geometries, spokes: spoke.material };
		parent.add?.(group);
		this.deps.shownChanged();
		this.#fade = EGO_HIDDEN;
		this.#fadeTo(1);
		this.tick();
	}

	/** Fades the overlay out; it is released once the fade ends. */
	hide(): void {
		this.#fadeTo(0);
	}

	/** Fades the overlay back in, from the opacity it holds, where it fades out. */
	keepVisible(): void {
		this.#fadeTo(1);
	}

	/** Shows the overlay again in the colours the theme states now, at the fade it holds. */
	restyle(): void {
		const active = this.#active;
		if (active === undefined) return;
		const [fade, fading] = [this.#fade, this.#fading];
		this.hideImmediate();
		this.show(...active.shownFor);
		[this.#fade, this.#fading] = [fade, fading];
		this.tick();
	}

	/** Places each chip and label at the fade's opacity now, and releases the overlay once a fade-out ends. */
	tick(): void {
		const active = this.#active;
		if (active === undefined) return;
		const now = this.deps.clock.now();
		const alpha = fadeOpacity(this.#fade, now);
		for (const { placed, visual, predicate } of active.virtuals) {
			const chip = teleportStation(placed.node, placed.pos, alpha);
			visual.object.position.set(chip.pos.x, chip.pos.y, chip.pos.z);
			visual.opacity = chip.opacity * CHIP_OPACITY;
			const label = teleportStation(placed.node, placed.predicatePos, alpha);
			predicate.object.position.set(label.pos.x, label.pos.y, label.pos.z);
			predicate.opacity = label.opacity;
		}
		if (active.spokes) active.spokes.opacity = alpha * SPOKE_OPACITY;
		this.#fading = !fadeEnded(this.#fade, now);
		if (!this.#fading && this.#fade.to === 0) this.hideImmediate();
	}

	/** Releases the overlay at once. */
	hideImmediate(): void {
		const active = this.#active;
		if (active === undefined) return;
		disposeGroup(active.group, false);
		for (const geometry of active.geometries) geometry.dispose();
		this.#active = undefined;
		[this.#fade, this.#fading] = [EGO_HIDDEN, false];
		this.deps.shownChanged();
	}

	/** Returns what of the overlay the client point `pointer` hits on the canvas `rect`, keeps a hit overlay shown, and
	 *  lights the chip of a neighbour it hits. */
	testPointer(pointer: { x: number; y: number }, rect: TCanvasRect): TEgoCorridorHit {
		const active = this.#active;
		const [T, camera] = [this.deps.three(), this.deps.camera()];
		if (active === undefined || !T || !camera) return { kind: "miss" };
		const v = new T.Vector3();
		const client = (p: XYZ) => {
			v.set(p.x, p.y, p.z);
			return ndcToClient(v.project(camera), rect);
		};
		const box = (p: XYZ, worldWidth: number, least: { width: number; height: number }) => {
			const perPx = this.deps.worldPerPxAt(p);
			const [width, height] = perPx === null ? [least.width, least.height] : [Math.max(least.width, worldWidth / perPx), Math.max(least.height, EGO_CHIP_HEIGHT / perPx)];
			// A chip's point is its top-left corner, and the hit test reads a box by its centre.
			const at = client(p);
			return { x: at.x + width / 2, y: at.y + height / 2, width, height };
		};
		const targets = active.virtuals.map(
			({ placed, label }): TEgoNeighbourTarget => ({
				id: placed.node.id,
				box: box(placed.pos, approximateChipWidth(label) + EGO_CHIP_PADDING, MIN_CHIP_PX),
				spokePoints: placed.spokePoints.map(client),
			}),
		);
		const hit = evaluateEgoCorridorHit(pointer, box(active.center, approximateChipWidth(active.center.name), MIN_CENTER_PX), targets);
		if (hit.kind !== "miss") this.keepVisible();
		const lit = hit.kind === "chip" || hit.kind === "spoke" ? hit.neighbourId : undefined;
		for (const { placed, visual } of active.virtuals) visual.setHighlighted(placed.node.id === lit, FULL_BURN);
		this.deps.markDirty("ego");
		return hit;
	}

	/** Returns the neighbour whose chip, or whose spoke past `PICK_SPOKE_SHARE`, the client point `pointer` hits. */
	pickNeighbour(pointer: { x: number; y: number }, rect: TCanvasRect): FGNode | undefined {
		const hit = this.testPointer(pointer, rect);
		const picked = hit.kind === "chip" || (hit.kind === "spoke" && hit.t > PICK_SPOKE_SHARE) ? hit.neighbourId : undefined;
		return this.#active?.virtuals.find(({ placed }) => placed.node.id === picked)?.placed.node;
	}

	#fadeTo(to: 0 | 1): void {
		if (this.#active === undefined) return;
		this.#fade = fadeToward(this.#fade, to, this.deps.clock.now());
		this.#fading = true;
		this.deps.markDirty("ego");
	}

	/** Returns the camera as the layout reads it at `center`, undefined until the camera is ready. */
	#view(T: EgoThree, camera: TSceneCamera, center: XYZ, rect: TCanvasRect): TEgoView | undefined {
		camera.updateMatrixWorld?.(true);
		const [perPx, matrix] = [this.deps.worldPerPxAt(center), camera.matrixWorld];
		if (perPx === null || matrix === undefined) return undefined;
		const v = new T.Vector3();
		const project = (p: XYZ) => {
			v.set(p.x, p.y, p.z);
			const ndc = v.project(camera);
			return { x: ndc.x, y: ndc.y, inFront: Math.abs(ndc.z) < 1 };
		};
		const half = (px: number) => (px / 2) * perPx * EGO_VIEWPORT_MARGIN;
		return { basis: cameraBasis(matrix.elements), project, bounds: { rx: half(rect.width), ry: half(rect.height) } };
	}
}
