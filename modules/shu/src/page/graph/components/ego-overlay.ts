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
import { evaluateEgoCorridorHit, type TEgoCorridorHit, type TEgoNeighbourTarget } from "../derivations/ego-corridor.js";
import {
	approximateChipWidth,
	computeEgoPositions,
	DEFAULT_MAX_EGO_NEIGHBOURS,
	EGO_CHIP_HEIGHT,
	extractEgoGraph,
	type TEgoGraph,
	type TEgoPositionedNeighbour,
	type TEgoPositions,
} from "../derivations/ego-layout.js";
import { FULL_BURN } from "../derivations/highlight.js";
import { ndcToClient, type TCanvasRect } from "../derivations/project.js";
import { teleportStation } from "../derivations/teleport-transition.js";
import { typeAvatar } from "../derivations/type-avatar.js";
import type { NodeMark } from "../domains/graph-scene.js";
import type { FGLink, FGNode, LabelVisual, NodeVisual, Obj3D, XYZ } from "../domains/graph-types.js";
import { makeTroikaChip, makeTroikaText, type ChipThree } from "./troika-label.js";

export const EGO_OVERLAY_RENDER_ORDER = 800;
export const EGO_TELEPORT_IN_MS = 360;
export const EGO_TELEPORT_OUT_MS = 220;
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

type TVirtualNeighbour = { target: TEgoPositionedNeighbour; visual: NodeVisual; label?: LabelVisual };

type TActiveOverlay = {
	centerId: string;
	group: Obj3D & { add(child: unknown): void; remove(child: unknown): void; children?: unknown[] };
	lineMesh?: Obj3D & { geometry?: Disposable; material?: { opacity: number; dispose?: () => void } };
	visuals: NodeVisual[];
	labels: LabelVisual[];
	virtualNeighbours: TVirtualNeighbour[];
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
	#lastTick = 0;
	#dashUniform?: { value: number };

	constructor(deps: TEgoOverlayDeps) {
		this.deps = deps;
	}

	get activeCenterId(): string | undefined {
		return this.#active?.centerId;
	}

	get isVisible(): boolean {
		return this.#active !== undefined;
	}

	/** Returns active overlay labels and visuals to billboard towards camera and advances animated dash uniform. */
	labels(): Array<{ faceCamera: (q: { x: number; y: number; z: number; w: number }) => void }> {
		if (!this.#active) return [];
		if (this.#dashUniform) {
			const now = this.deps.clock.now();
			const dt = this.#lastTick > 0 ? Math.min(0.1, (now - this.#lastTick) / 1000) : 0.016;
			this.#lastTick = now;
			this.#dashUniform.value += 12 * dt;
		}
		return [...this.#active.labels, ...this.#active.visuals];
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

		// Calculate viewport perimeter bounds from camera distance to hovered node
		const camera = this.deps.camera() as
			| { fov?: number; aspect?: number; position?: { x: number; y: number; z: number }; matrixWorld?: { elements: number[] }; updateMatrixWorld?: (force: boolean) => void }
			| undefined;
		camera?.updateMatrixWorld?.(true);

		const camElements = camera?.matrixWorld?.elements;
		const hasWorldTranslation = camElements && camElements.length >= 15 && (camElements[12] !== 0 || camElements[13] !== 0 || camElements[14] !== 0);
		const camWorldX = hasWorldTranslation ? camElements[12] : camera?.position?.x;
		const camWorldY = hasWorldTranslation ? camElements[13] : camera?.position?.y;
		const camWorldZ = hasWorldTranslation ? camElements[14] : camera?.position?.z;

		let viewBounds: { rx: number; ry: number } | undefined;
		let camBasis: { right: XYZ; up: XYZ } | undefined;
		if (camera && camWorldX !== undefined && camWorldY !== undefined && camWorldZ !== undefined) {
			const dist = Math.hypot(camWorldX - hoveredNode.x, camWorldY - hoveredNode.y, camWorldZ - hoveredNode.z);
			const fov = camera.fov !== undefined ? camera.fov : 50;
			const fovRad = (fov * Math.PI) / 180;
			const visibleHalfH = dist * Math.tan(fovRad / 2);
			const aspect = camera.aspect !== undefined ? camera.aspect : 1.6;
			const visibleHalfW = visibleHalfH * aspect;
			// Push out towards the perimeter / edge (88% of half extent to maximize screen space)
			viewBounds = { rx: Math.max(30, visibleHalfW * 0.88), ry: Math.max(20, visibleHalfH * 0.88) };
			if (camElements && camElements.length >= 7) {
				const rX = camElements[0] !== undefined ? camElements[0] : 1;
				const rY = camElements[1] !== undefined ? camElements[1] : 0;
				const rZ = camElements[2] !== undefined ? camElements[2] : 0;
				const uX = camElements[4] !== undefined ? camElements[4] : 0;
				const uY = camElements[5] !== undefined ? camElements[5] : 1;
				const uZ = camElements[6] !== undefined ? camElements[6] : 0;
				camBasis = { right: { x: rX, y: rY, z: rZ }, up: { x: uX, y: uY, z: uZ } };
			}
		}

		const v = new T.Vector3();
		const el8 = camElements ? camElements[8] : undefined;
		const el9 = camElements ? camElements[9] : undefined;
		const el10 = camElements ? camElements[10] : undefined;
		const fwdX = el8 !== undefined ? -el8 : 0;
		const fwdY = el9 !== undefined ? -el9 : 0;
		const fwdZ = el10 !== undefined ? -el10 : -1;
		const rawLen = Math.hypot(fwdX, fwdY, fwdZ);
		const fwdLen = rawLen > 0 ? rawLen : 1;
		const forwardX = fwdX / fwdLen;
		const forwardY = fwdY / fwdLen;
		const forwardZ = fwdZ / fwdLen;

		const project = (point: XYZ) => {
			if (!camera || camWorldX === undefined || camWorldY === undefined || camWorldZ === undefined) return { x: 0, y: 0, inFront: true };
			const toX = point.x - camWorldX;
			const toY = point.y - camWorldY;
			const toZ = point.z - camWorldZ;
			const dot = toX * forwardX + toY * forwardY + toZ * forwardZ;
			const inFront = dot > 0.1;
			v.set(point.x, point.y, point.z);
			const p = v.project(camera);
			return { x: p.x, y: p.y, inFront: inFront && p.z < 1 };
		};

		// Keep virtual neighbour chips firmly along the outer visible perimeter (scale = 1.0)
		const targetPositions = computeEgoPositions(egoGraph, 1.0, { viewBounds, focalPlane: true, camBasis, project });

		const group = new T.Group();
		(group as Obj3D & { name?: string }).name = "shu-ego-overlay";

		const visuals: NodeVisual[] = [];
		const labels: LabelVisual[] = [];
		const virtualNeighbours: TVirtualNeighbour[] = [];
		const colors = this.deps.colors();

		// Shared animated dashed material for spokes and local framing borders
		const dashUniform = { value: 0 };
		this.#dashUniform = dashUniform;

		const material = new T.LineDashedMaterial({ color: colors.accent, dashSize: 1.8, gapSize: 1.0, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
		const matWithShader = material as unknown as { onBeforeCompile?: (s: { uniforms: Record<string, unknown>; fragmentShader: string }) => void };
		matWithShader.onBeforeCompile = (shader) => {
			shader.uniforms.uDashOffset = dashUniform;
			shader.fragmentShader = shader.fragmentShader
				.replace("uniform float totalSize;", "uniform float totalSize;\nuniform float uDashOffset;")
				.replace("mod( vLineDistance", "mod( vLineDistance + uDashOffset");
		};

		// Virtual perimeter neighbour chips and radial connector lines (ONLY for off-screen neighbours!)
		const linePoints: number[] = [];
		for (const n of targetPositions.neighbours) {
			if (!n.isOffscreen) {
				// Node is ALREADY in the visible viewport: DO NOT MOVE IT or duplicate it!
				// The real node and real edge are already rendered in the 3D graph scene.
				continue;
			}

			const mark = this.deps.markFor(n.node);
			const labelText = this.deps.chipLabelOf(n.node, mark);
			const rawAvatar = typeAvatar(mark.type);
			const virtualAvatar = rawAvatar ? `~${rawAvatar}` : "~";

			// Dynamic animated dashed framing border that updates to match exact measured chip bounds
			const pad = 0.35;
			const boxGeo = new T.BufferGeometry();
			let boxLines: Obj3D & { computeLineDistances: () => void };

			const updateBox = (w: number, h: number, cx: number, cy: number) => {
				const x1 = cx - w / 2 - pad;
				const x2 = cx + w / 2 + pad;
				const y1 = cy - h / 2 - pad;
				const y2 = cy + h / 2 + pad;
				const z = 0.05;
				const bp = [x1, y2, z, x2, y2, z, x2, y2, z, x2, y1, z, x2, y1, z, x1, y1, z, x1, y1, z, x1, y2, z];
				boxGeo.setAttribute("position", new T.Float32BufferAttribute(bp, 3));
				boxLines?.computeLineDistances();
			};

			const visual = makeTroikaChip(labelText, mark.color, T as unknown as ChipThree, {
				fontSize: CHIP_TEXT_HEIGHT,
				renderOrder: EGO_OVERLAY_RENDER_ORDER + 1,
				textColor: colors.text,
				borderColor: colors.accent,
				highlightColor: colors.highlight,
				avatar: virtualAvatar,
				laidOut: () => {
					const bg = visual.pickTarget as unknown as { position: { x: number; y: number }; scale: { x: number; y: number } };
					if (bg && bg.scale.x > 0 && bg.scale.y > 0) {
						updateBox(bg.scale.x, bg.scale.y, bg.position.x, bg.position.y);
					}
					this.deps.markDirty("label");
				},
			});
			visual.object.position.set(n.pos.x, n.pos.y, n.pos.z);
			visual.pickTarget.raycast = () => undefined;

			// Initial box bounds matching Troika anchor and estimated width
			const initW = approximateChipWidth(labelText) + (virtualAvatar ? 6 : 0);
			const initH = EGO_CHIP_HEIGHT;
			const margin = CHIP_TEXT_HEIGHT * 0.12;
			updateBox(initW, initH, -margin + initW / 2, margin - initH / 2);

			boxLines = new T.LineSegments(boxGeo, material);
			boxLines.computeLineDistances();
			boxLines.raycast = () => undefined;
			boxLines.renderOrder = EGO_OVERLAY_RENDER_ORDER + 1;
			(visual.object as unknown as { add: (c: unknown) => void }).add(boxLines);

			group.add(visual.object);
			visuals.push(visual);

			// Connect curved spoke from center to neighbour (following exact quadratic link curvature)
			if (n.spokePoints && n.spokePoints.length > 1) {
				for (let j = 0; j < n.spokePoints.length - 1; j++) {
					const pA = n.spokePoints[j];
					const pB = n.spokePoints[j + 1];
					if (pA && pB) {
						linePoints.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
					}
				}
			} else {
				linePoints.push(targetPositions.center.x, targetPositions.center.y, targetPositions.center.z, n.pos.x, n.pos.y, n.pos.z);
			}

			// Predicate label at staggered, perpendicularly offset position
			let predLabel: LabelVisual | undefined;
			if (n.link.predicate && n.predicatePos) {
				predLabel = makeTroikaText(n.link.predicate, {
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

			virtualNeighbours.push({ target: n, visual, label: predLabel });
		}

		// Radial connector spokes
		let lineMesh: (Obj3D & { geometry?: Disposable; material?: { opacity: number; dispose?: () => void } }) | undefined;
		if (linePoints.length > 0) {
			const geometry = new T.BufferGeometry();
			geometry.setAttribute("position", new T.Float32BufferAttribute(linePoints, 3));
			const lines = new T.LineSegments(geometry, material);
			lines.computeLineDistances();
			lines.raycast = () => undefined;
			lines.renderOrder = EGO_OVERLAY_RENDER_ORDER;
			group.add(lines);
			lineMesh = lines;
		}

		this.#active = { centerId: hoveredNode.id, group, lineMesh, visuals, labels, virtualNeighbours, targetPositions, egoGraph };
		this.#applyState(0);
		parent.add?.(group);

		this.#lastTick = this.deps.clock.now();
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

		const duration = this.#animTo === 1 ? EGO_TELEPORT_IN_MS : EGO_TELEPORT_OUT_MS;
		const elapsed = this.deps.clock.now() - this.#animStart;
		const progress = Math.min(1, Math.max(0, elapsed / duration));

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
		const { virtualNeighbours, lineMesh } = this.#active;

		for (const vn of virtualNeighbours) {
			const origin = { x: vn.target.node.x, y: vn.target.node.y, z: vn.target.node.z };
			const station = teleportStation(origin, vn.target.pos, alpha);
			vn.visual.object.position.set(station.pos.x, station.pos.y, station.pos.z);
			vn.visual.opacity = station.opacity * 0.9;
			if (vn.label) {
				const predStation = teleportStation(origin, vn.target.predicatePos, alpha);
				vn.label.object.position.set(predStation.pos.x, predStation.pos.y, predStation.pos.z);
				vn.label.opacity = predStation.opacity;
			}
		}

		if (lineMesh?.material) {
			lineMesh.material.opacity = alpha * 0.85;
		}
	}

	/**
	 * Tests pointer coordinates against the active ego constellation.
	 * Highlights the hovered neighbour chip and spoke if within corridor.
	 */
	testPointer(pointer: { x: number; y: number }, rect: TCanvasRect): TEgoCorridorHit {
		if (!this.#active) return { kind: "miss" };
		const camera = this.deps.camera();
		const T = this.deps.three() as unknown as EgoThree;
		if (!camera || !T) return { kind: "miss" };
		(camera as unknown as { updateMatrixWorld?: (force: boolean) => void })?.updateMatrixWorld?.(true);

		const { center, neighbours } = this.#active.targetPositions;
		const centerNode = this.#active.egoGraph.center;
		const v = new T.Vector3();

		v.set(center.x, center.y, center.z);
		const cNdc = v.project(camera);
		const cPixel = ndcToClient({ x: cNdc.x, y: cNdc.y }, rect);
		const centerW = Math.max(100, approximateChipWidth(centerNode.name) * 4);
		const centerH = 32;

		const targets: TEgoNeighbourTarget[] = [];
		for (let i = 0; i < neighbours.length; i++) {
			const n = neighbours[i];
			if (!n) continue;
			v.set(n.pos.x, n.pos.y, n.pos.z);
			const pNdc = v.project(camera);
			const pPixel = ndcToClient({ x: pNdc.x, y: pNdc.y }, rect);
			const w = Math.max(80, approximateChipWidth(n.node.name) * 4);
			const h = 28;
			const spokePoints = n.spokePoints?.map((pt) => {
				v.set(pt.x, pt.y, pt.z);
				const ptNdc = v.project(camera);
				return ndcToClient({ x: ptNdc.x, y: ptNdc.y }, rect);
			});
			targets.push({ id: n.node.id, pos: pPixel, width: w, height: h, spokePoints });
		}

		const hit = evaluateEgoCorridorHit(pointer, { x: cPixel.x, y: cPixel.y, width: centerW, height: centerH }, targets, { centerPadding: 32, corridorRadius: 55, chipPadding: 16 });
		const highlightId = hit.kind === "chip" || hit.kind === "spoke" ? hit.neighbourId : undefined;
		this.applyHighlight(highlightId);

		return hit;
	}

	/**
	 * Returns the real FGNode for a clicked neighbour if pointer hits its chip or destination end of spoke.
	 */
	pickNeighbour(pointer: { x: number; y: number }, rect: TCanvasRect): FGNode | undefined {
		if (!this.#active || !this.isVisible) return undefined;
		const hit = this.testPointer(pointer, rect);
		if (hit.kind === "chip" || (hit.kind === "spoke" && hit.t > 0.6)) {
			const match = this.#active.targetPositions.neighbours.find((n) => n.node.id === hit.neighbourId);
			return match ? match.node : undefined;
		}
		return undefined;
	}

	applyHighlight(neighbourId: string | undefined): void {
		if (!this.#active) return;
		for (const n of this.#active.targetPositions.neighbours) {
			const isTarget = neighbourId !== undefined && n.node.id === neighbourId;
			n.node.__visual?.setHighlighted(isTarget, FULL_BURN);
		}
		for (const vn of this.#active.virtualNeighbours) {
			const isTarget = neighbourId !== undefined && vn.target.node.id === neighbourId;
			vn.visual.setHighlighted(isTarget, FULL_BURN);
		}
		this.deps.markDirty("focus");
	}

	#disposeActive(): void {
		if (!this.#active) return;
		for (const n of this.#active.targetPositions.neighbours) {
			n.node.__visual?.setHighlighted(false, FULL_BURN);
		}
		this.#dashUniform = undefined;
		this.#lastTick = 0;
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
