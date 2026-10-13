/**
 * The gantt view's overlays: the calendar ruler below the lowest lane, and the ghost a dragged bar wears, its outline and
 * the start its drop would set. Both are drawn in the node coordinate space, parented as the enclosures are, and built
 * from the scene's own THREE (SH21, CA3D5).
 */
import { formatInstant, readerZone } from "../../derivations/time-format.js";
import { ganttBarSpan, GANTT_BAR_D, GANTT_BAR_H, GANTT_GHOST_PAD, GANTT_MIN_BAR_W, GANTT_ROW_H, type GanttScale, type GanttTarget } from "../derivations/gantt-layout.js";
import type { Adornment } from "../derivations/graph-layout.js";
import { isPlaced, type FGNode, type LabelVisual } from "../domains/graph-types.js";
import { makeTroikaText } from "./troika-label.js";
import { ENCLOSURE_LABEL_HEIGHT, ENCLOSURE_LABEL_RENDER_ORDER, ENCLOSURE_RENDER_ORDER, type Disposable, type EnclosureThree, type Obj3D } from "./enclosure.js";

/** The enclosures' slice of THREE and the line geometry the ruler builds. */
export type GanttThree = EnclosureThree & {
	BufferGeometry: new () => Disposable & { setAttribute(name: string, attr: unknown): void };
	Float32BufferAttribute: new (array: number[], itemSize: number) => unknown;
};

export type TGanttOverlayDeps = {
	three: () => GanttThree | undefined;
	/** The object the overlays are parented to, which shares the nodes' coordinate space. */
	parent: () => Obj3D | undefined;
	/** The shared unit-box edges the ghost outlines a bar with, built on first use. */
	unitEdges: (three: GanttThree) => Disposable | undefined;
	/** The overlays' text colour and the ruler's and outline's accent. */
	colors: () => { text: string; accent: string };
};

type TGhost = { group: Obj3D; edges: Obj3D; label: LabelVisual };

export class GanttOverlay {
	#axis: Obj3D | undefined;
	#axisLabels: LabelVisual[] = [];
	#ghost: TGhost | undefined;

	constructor(private readonly deps: TGanttOverlayDeps) {}

	/** The overlays' labels, which the scene turns to the camera. */
	labels(): LabelVisual[] {
		return this.#ghost === undefined ? this.#axisLabels : [...this.#axisLabels, this.#ghost.label];
	}

	/** Draw the calendar ruler the layout produced: a baseline along z, the time axis, with a tick and a date at each mark.
	 *  The ruler is rebuilt, since its marks change with the data and the scale; a layout without a calendar clears it. */
	drawAxis(adornment: Adornment): void {
		this.clearAxis();
		const T = this.deps.three();
		const parent = this.deps.parent();
		if (!T || !adornment || !parent) return;
		const { baseY, zMin, zMax, ticks } = adornment;
		const tickH = GANTT_ROW_H * 0.5;
		const group = new T.Group();
		(group as Obj3D & { name: string }).name = "shu-gantt-axis";
		const points = [0, baseY, zMin, 0, baseY, zMax];
		for (const tick of ticks) points.push(0, baseY, tick.z, 0, baseY + tickH, tick.z);
		const geometry = new T.BufferGeometry();
		geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
		const lines = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: this.deps.colors().accent, transparent: true, opacity: 0.7, depthWrite: false }));
		lines.raycast = () => undefined;
		lines.renderOrder = ENCLOSURE_RENDER_ORDER;
		group.add(lines);
		for (const tick of ticks) {
			const label = this.#label(tick.label);
			label.object.position.set(0, baseY - tickH, tick.z);
			group.add(label.object);
			this.#axisLabels.push(label);
		}
		parent.add(group);
		this.#axis = group;
	}

	clearAxis(): void {
		if (this.#axis) disposeGroup(this.#axis, true); // the ruler owns its line geometry
		this.#axis = undefined;
		this.#axisLabels = [];
	}

	/** Outline a dragged bar at its live position, with the start its drop would set, updated each move. */
	drawGhost(node: FGNode, target: GanttTarget, scale: GanttScale): void {
		const T = this.deps.three();
		if (!T || !isPlaced(node)) return;
		const unitEdges = this.deps.unitEdges(T);
		const parent = this.deps.parent();
		if (!parent || !unitEdges) return;
		if (!this.#ghost) {
			const edges = new T.LineSegments(
				unitEdges,
				new T.LineBasicMaterial({ color: this.deps.colors().accent, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }),
			);
			edges.raycast = () => undefined;
			edges.renderOrder = ENCLOSURE_LABEL_RENDER_ORDER;
			const label = this.#label("");
			const group = new T.Group();
			group.add(edges);
			group.add(label.object);
			parent.add(group);
			this.#ghost = { group, edges, label };
		}
		const { edges, label } = this.#ghost;
		const { x, y } = node;
		edges.scale.set(GANTT_BAR_D + GANTT_GHOST_PAD, GANTT_BAR_H + GANTT_GHOST_PAD, Math.max(target.zLen, GANTT_MIN_BAR_W) + GANTT_GHOST_PAD);
		edges.position.set(x, y, node.z);
		label.text = formatInstant(new Date(ganttBarSpan(node.z, target.zLen, scale).start).toISOString(), new Date(), readerZone());
		label.object.position.set(x, y + GANTT_BAR_H, node.z);
	}

	clearGhost(): void {
		if (this.#ghost) disposeGroup(this.#ghost.group, false); // the ghost shares the enclosures' unit edges
		this.#ghost = undefined;
	}

	dispose(): void {
		this.clearAxis();
		this.clearGhost();
	}

	/** An overlay label: drawn on top, never hidden by depth, never picked. */
	#label(text: string): LabelVisual {
		return makeTroikaText(text, {
			fontSize: ENCLOSURE_LABEL_HEIGHT,
			color: this.deps.colors().text,
			renderOrder: ENCLOSURE_LABEL_RENDER_ORDER,
			anchor: { x: "center", y: "middle" },
			emphasis: false,
		});
	}
}

/** Detach a group from its parent and release each child's material and text, and its geometry where the group owns it. */
function disposeGroup(group: Obj3D, ownsGeometry: boolean): void {
	if (group.children !== undefined)
		for (const child of [...group.children]) {
			const c = child as { geometry?: Disposable; material?: Disposable; dispose?: () => void };
			if (ownsGeometry) c.geometry?.dispose();
			c.material?.dispose();
			c.dispose?.(); // a troika label owns its text's geometry
		}
	group.parent?.remove(group);
}
