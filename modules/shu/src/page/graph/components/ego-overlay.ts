/**
 * EgoOverlay: 3D scene overlay that presents a virtual 1-hop ego-neighborhood around a hovered node.
 *
 * Requirements:
 * - Hovered node does not shift from (x0, y0, z0).
 * - Central ego node is at the exact same position (x0, y0, z0) with full-burn highlight.
 * - Virtual neighbour nodes maintain their z (temporal) coordinates strictly invariant (zi_ego = zi).
 * - Lateral (x, y) coordinates distribute into an orbital constellation using available viewport area.
 * - Chips are relaxed with 2D AABB collision avoidance so text never overlaps.
 * - Edge predicates are staggered and offset perpendicularly to prevent text overlap.
 * - Virtual nodes are clearly distinguished:
 *   - Translucent background (0.82 opacity)
 *   - Distinct dashed accent outline border
 *   - Virtual indicator badge prefix (~TA, ~CI)
 *   - Dashed radial connector lines
 * - Native Three.js objects (Group, Troika text/chips, LineSegments, LineLoop) in world space,
 *   billboarded each frame and fully compatible with WebXR / VR.
 */
import {
	approximateChipWidth,
	computeEgoPositions,
	computeViewportFitScale,
	DEFAULT_MAX_EGO_NEIGHBOURS,
	DEFAULT_VIEWPORT_MARGIN,
	extractEgoGraph,
	type TEgoGraph,
	type TEgoPositions,
} from "../derivations/ego-layout.js";
import { FULL_BURN } from "../derivations/highlight.js";
import { typeAvatar } from "../derivations/type-avatar.js";
import type { NodeMark } from "../domains/graph-scene.js";
import type { FGLink, FGNode, LabelVisual, NodeVisual, Obj3D, XYZ } from "../domains/graph-types.js";
import { makeTroikaChip, makeTroikaText, type ChipThree } from "./troika-label.js";

export const EGO_OVERLAY_RENDER_ORDER = 800;
export const EGO_TRANSITION_MS = 150;
const CHIP_TEXT_HEIGHT = 3.0;

export type EgoThree = {
	Vector3: new (
		x?: number,
		y?: number,
		z?: number,
	) => { x: number; y: number; z: number; set(x: number, y: number, z: number): void; project(camera: unknown): { x: number; y: number; z: number } };
	Group: new () => Obj3D & { add(child: unknown): void; remove(child: unknown): void; children?: unknown[] };
	BufferGeometry: new () => Disposable & { setAttribute(name: string, attr: unknown): void; setFromPoints(points: unknown[]): unknown };
	Float32BufferAttribute: new (array: number[], itemSize: number) => unknown;
	LineSegments: new (g: unknown, m: unknown) => Obj3D & { computeLineDistances(): void };
	LineLoop: new (g: unknown, m: unknown) => Obj3D & { computeLineDistances(): void };
	LineDashedMaterial: new (opts: unknown) => Disposable & { opacity: number };
};

export type TEgoOverlayDeps = {
	three: () => unknown;
	camera: () => unknown;
	parent: () => Obj3D | undefined;
	clock: { now: () => number; frame: (cb: () => void) => void };
	colors: () => { text: string; border: string; highlight: string; accent: string };
	markFor: (node: FGNode) => NodeMark;
	chipLabelOf: (node: FGNode, mark: NodeMark) => string;
	markDirty: (kind: "label" | "focus") => void;
};

type TActiveOverlay = {
	centerId: string;
	group: Obj3D & { add(child: unknown): void; remove(child: unknown): void; children?: unknown[] };
	lineMesh?: Obj3D & { geometry?: Disposable; material?: { opacity: number; dispose?: () => void } };
	visuals: NodeVisual[];
	labels: LabelVisual[];
	targetPositions: TEgoPositions;
	egoGraph: TEgoGraph;
};

type Disposable = { dispose?: () => void };

export class EgoOverlay {
	readonly deps: TEgoOverlayDeps;
	#active: TActiveOverlay | undefined;
	#opacity = 0;
	#animating = false;
	#animStart = 0;
	#animFrom = 0;
	#animTo = 0;

	constructor(deps: TEgoOverlayDeps) {
		this.deps = deps;
	}

	get activeCenterId(): string | undefined {
		return this.#active?.centerId;
	}

	get isVisible(): boolean {
		return this.#opacity > 0;
	}

	/** Returns active overlay labels to billboard towards camera. */
	labels(): LabelVisual[] {
		return this.#active ? this.#active.labels : [];
	}

	/**
	 * Activate and display ego overlay for `hoveredNode`.
	 * Idempotent if already active for this node.
	 */
	show(hoveredNode: FGNode & XYZ, nodeMap: Map<string, FGNode>, links: Iterable<FGLink>): void {
		if (this.#active?.centerId === hoveredNode.id) return;

		const parent = this.deps.parent();
		if (!parent) return;

		const T = this.deps.three() as unknown as EgoThree;
		if (!T) return;

		// Clear existing overlay if any
		this.hideImmediate();

		const egoGraph = extractEgoGraph(hoveredNode.id, nodeMap, links, DEFAULT_MAX_EGO_NEIGHBOURS);
		if (!egoGraph || egoGraph.neighbours.length === 0) return;

		// Calculate viewport fit scale
		const camera = this.deps.camera();
		const v = new T.Vector3();
		const project = (point: XYZ) => {
			if (!camera) return { x: 0, y: 0, inFront: true };
			v.set(point.x, point.y, point.z);
			const p = v.project(camera);
			return { x: p.x, y: p.y, inFront: p.z < 1 };
		};

		const optimalScale = computeViewportFitScale(egoGraph, project, DEFAULT_VIEWPORT_MARGIN);
		const targetPositions = computeEgoPositions(egoGraph, optimalScale);

		const group = new T.Group();
		(group as Obj3D & { name?: string }).name = "shu-ego-overlay";

		const visuals: NodeVisual[] = [];
		const labels: LabelVisual[] = [];
		const colors = this.deps.colors();

		// 1. Central node chip (anchored at identical position x0, y0, z0)
		const centerMark = this.deps.markFor(egoGraph.center);
		const centerLabel = this.deps.chipLabelOf(egoGraph.center, centerMark);
		const centerVisual = makeTroikaChip(centerLabel, centerMark.color, T as unknown as ChipThree, {
			fontSize: CHIP_TEXT_HEIGHT,
			renderOrder: EGO_OVERLAY_RENDER_ORDER + 1,
			textColor: colors.text,
			borderColor: colors.border,
			highlightColor: colors.highlight,
			avatar: typeAvatar(centerMark.type),
			laidOut: () => this.deps.markDirty("label"),
		});
		centerVisual.object.position.set(targetPositions.center.x, targetPositions.center.y, targetPositions.center.z);
		centerVisual.setHighlighted(true, FULL_BURN);
		centerVisual.pickTarget.raycast = () => undefined;
		group.add(centerVisual.object);
		visuals.push(centerVisual);

		// 2. Neighbour chips and connecting lines
		const linePoints: number[] = [];
		for (const n of targetPositions.neighbours) {
			const mark = this.deps.markFor(n.node);
			const labelText = this.deps.chipLabelOf(n.node, mark);
			const rawAvatar = typeAvatar(mark.type);
			const virtualAvatar = rawAvatar ? `~${rawAvatar}` : "~";

			const visual = makeTroikaChip(labelText, mark.color, T as unknown as ChipThree, {
				fontSize: CHIP_TEXT_HEIGHT,
				renderOrder: EGO_OVERLAY_RENDER_ORDER + 1,
				textColor: colors.text,
				borderColor: colors.accent,
				highlightColor: colors.highlight,
				avatar: virtualAvatar,
				laidOut: () => this.deps.markDirty("label"),
			});
			visual.object.position.set(n.pos.x, n.pos.y, n.pos.z);
			visual.pickTarget.raycast = () => undefined;

			// Add dashed accent border outline to distinguish virtual node
			const approxW = approximateChipWidth(labelText);
			const halfW = approxW / 2;
			const halfH = (CHIP_TEXT_HEIGHT * 1.35) / 2;
			const boxPoints = [new T.Vector3(-halfW, -halfH, 0.05), new T.Vector3(halfW, -halfH, 0.05), new T.Vector3(halfW, halfH, 0.05), new T.Vector3(-halfW, halfH, 0.05)];
			const boxGeom = new T.BufferGeometry();
			boxGeom.setFromPoints(boxPoints);
			const dashedMat = new T.LineDashedMaterial({ color: colors.accent, dashSize: 1.2, gapSize: 0.6, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
			const dashedBox = new T.LineLoop(boxGeom, dashedMat);
			dashedBox.computeLineDistances();
			dashedBox.raycast = () => undefined;
			dashedBox.renderOrder = EGO_OVERLAY_RENDER_ORDER + 3;
			const obj = visual.object as Obj3D & { add?: (c: unknown) => void };
			obj.add?.(dashedBox);

			group.add(visual.object);
			visuals.push(visual);

			// Connect line from center to neighbour
			linePoints.push(targetPositions.center.x, targetPositions.center.y, targetPositions.center.z, n.pos.x, n.pos.y, n.pos.z);

			// Predicate label at staggered, perpendicularly offset position
			if (n.link.predicate && n.predicatePos) {
				const predLabel = makeTroikaText(n.link.predicate, {
					fontSize: CHIP_TEXT_HEIGHT * 0.75,
					color: colors.accent,
					renderOrder: EGO_OVERLAY_RENDER_ORDER + 2,
					anchor: { x: "center", y: "middle" },
					emphasis: false,
				});
				predLabel.object.position.set(n.predicatePos.x, n.predicatePos.y, n.predicatePos.z);
				group.add(predLabel.object);
				labels.push(predLabel);
			}
		}

		// Dashed line segments
		let lineMesh: (Obj3D & { geometry?: Disposable; material?: { opacity: number; dispose?: () => void } }) | undefined;
		if (linePoints.length > 0) {
			const geometry = new T.BufferGeometry();
			geometry.setAttribute("position", new T.Float32BufferAttribute(linePoints, 3));
			const material = new T.LineDashedMaterial({ color: colors.accent, dashSize: 1.8, gapSize: 0.9, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false });
			const lines = new T.LineSegments(geometry, material);
			lines.computeLineDistances();
			lines.raycast = () => undefined;
			lines.renderOrder = EGO_OVERLAY_RENDER_ORDER;
			group.add(lines);
			lineMesh = lines;
		}

		parent.add?.(group);
		this.#active = { centerId: hoveredNode.id, group, lineMesh, visuals, labels, targetPositions, egoGraph };

		this.#startTransition(1);
	}

	/** Smoothly hide and dismiss the overlay. */
	hide(): void {
		if (!this.#active) return;
		if (this.#animTo !== 0) this.#startTransition(0);
	}

	/** Immediately dismiss and dispose of overlay resources. */
	hideImmediate(): void {
		if (!this.#active) return;
		this.#disposeActive();
		this.#active = undefined;
		this.#opacity = 0;
		this.#animating = false;
	}

	dispose(): void {
		this.hideImmediate();
	}

	#startTransition(to: number): void {
		this.#animFrom = this.#opacity;
		this.#animTo = to;
		this.#animStart = this.deps.clock.now();
		if (!this.#animating) {
			this.#animating = true;
			this.#tickAnimation();
		}
	}

	#tickAnimation(): void {
		if (!this.#animating || !this.#active) return;

		const elapsed = this.deps.clock.now() - this.#animStart;
		const progress = Math.min(1, Math.max(0, elapsed / EGO_TRANSITION_MS));

		this.#opacity = this.#animFrom + (this.#animTo - this.#animFrom) * progress;
		this.#applyState(this.#opacity);
		this.deps.markDirty("focus");

		if (progress < 1) {
			this.deps.clock.frame(() => this.#tickAnimation());
		} else {
			this.#animating = false;
			if (this.#animTo === 0) {
				this.hideImmediate();
			}
		}
	}

	#applyState(alpha: number): void {
		if (!this.#active) return;
		// Central node (index 0) gets full opacity; virtual neighbours get subtle 0.82 translucency
		for (let i = 0; i < this.#active.visuals.length; i++) {
			const visual = this.#active.visuals[i];
			if (visual) {
				visual.opacity = i === 0 ? alpha : alpha * 0.82;
			}
		}
		for (const label of this.#active.labels) {
			label.opacity = alpha;
		}
		if (this.#active.lineMesh?.material) {
			this.#active.lineMesh.material.opacity = alpha * 0.85;
		}
	}

	#disposeActive(): void {
		if (!this.#active) return;
		const { group, lineMesh, labels } = this.#active;
		for (const label of labels) {
			label.dispose();
		}
		if (lineMesh) {
			lineMesh.geometry?.dispose?.();
			lineMesh.material?.dispose?.();
		}
		if (group.children) {
			for (const child of [...group.children]) {
				const c = child as { geometry?: Disposable; material?: Disposable; dispose?: () => void };
				c.geometry?.dispose?.();
				c.material?.dispose?.();
				c.dispose?.();
			}
		}
		const parent = this.deps.parent();
		parent?.remove?.(group);
	}
}
