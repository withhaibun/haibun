// The node-drag state machine, lifted out of the polymorphic view component so its geometry + pin behaviour is unit-tested with
// stubs: no GPU, no raycaster, no rendered scene. The flake it replaces lived ENTIRELY in picking a pixel out of an
// occluded WebGL scene, never in this logic, which is pure number-shuffling once a node is picked. The component owns the
// DOM events + the THREE projection; this owns the state transitions: a press that stays put is a click; one that crosses
// the threshold pins the whole layout and drags a node; release leaves that node pinned while freeing the rest.
import type { XYZ } from "../grouping.js";
import type { FGNode } from "./polymorphic-graph-types.js";

export const DRAG_THRESHOLD_PX = 5; // a press that moves less than this is a click, not a drag

/** The interfaces the drag needs from its host: the pick + projection (THREE-backed in the component, stubbed in tests), the
 *  node set, the engine hold/freeze, the camera-controls toggle, and the gantt reschedule hooks. A `plane` is opaque here:
 *  the component derives the camera-facing plane through the node; this only holds it and passes it back to `planeHit`. */
export type NodeDragDeps = {
	pick: (e: PointerEvent) => FGNode | undefined; // press-time pick against the resting footprint
	makePlane: (node: FGNode) => unknown; // the camera-facing plane through the node, fixed at press time
	planeHit: (e: PointerEvent, plane: unknown) => XYZ | null; // where the pointer ray meets that plane
	nodes: () => Iterable<FGNode>;
	hold: () => void; // engine: apply the pins each tick, keep links tracking
	freeze: () => void; // engine: rest
	setControlsEnabled: (on: boolean) => void; // camera controls off during a press so it never pans
	dragReschedules: () => boolean; // gantt: z IS time, so a drag slides the bar along z instead of pinning x/y
	updateGhost: (node: FGNode) => void; // gantt: drag outline + the new date-time
	clearGhost: () => void;
	commit: (node: FGNode) => void; // gantt: rewrite the dragged bar's scheduled time
	selectedId: () => string | null; // the selected node stays pinned while selected
	dropDataPin: (id: string) => void; // the dragged node becomes a PERSISTENT pin, out of the transient data-feed set
};

export class NodeDrag {
	private pendingState?: { node: FGNode; plane: unknown; off: XYZ; downX: number; downY: number };
	private activeState?: { node: FGNode; plane: unknown; off: XYZ };
	constructor(private readonly d: NodeDragDeps) {}

	/** The press crossed the threshold: the layout is held and a node follows the pointer. */
	get dragging(): boolean {
		return !!this.activeState;
	}
	/** The id of the node currently being dragged, or null, for the host's inspect/paint. */
	get draggedId(): string | null {
		return this.activeState?.node.id ?? null;
	}
	/** The id of a captured-but-not-yet-dragging press, or null. */
	get pendingId(): string | null {
		return this.pendingState?.node.id ?? null;
	}

	down(e: PointerEvent): void {
		const node = this.d.pick(e);
		if (!node) return;
		const plane = this.d.makePlane(node);
		const hit = this.d.planeHit(e, plane);
		if (!hit) return;
		// Disable controls now, but do NOT pin/hold yet: a press that stays put is a CLICK (it opens the node's column).
		// The drag begins only once the pointer crosses the threshold (see move), so a click never reheats the layout.
		this.d.setControlsEnabled(false);
		this.pendingState = { node, plane, off: { x: (node.x ?? 0) - hit.x, y: (node.y ?? 0) - hit.y, z: (node.z ?? 0) - hit.z }, downX: e.clientX, downY: e.clientY };
	}

	move(e: PointerEvent): void {
		if (!this.activeState) {
			const p = this.pendingState;
			if (!p || Math.hypot(e.clientX - p.downX, e.clientY - p.downY) <= DRAG_THRESHOLD_PX) return; // still a potential click
			// Threshold crossed → promote to a real drag: NOW pin every node and hold the engine so nothing else moves.
			for (const n of this.d.nodes()) {
				n.fx = n.x;
				n.fy = n.y;
				n.fz = n.z;
			}
			this.d.hold();
			this.activeState = { node: p.node, plane: p.plane, off: p.off };
			this.pendingState = undefined;
		}
		const hit = this.d.planeHit(e, this.activeState.plane);
		if (!hit) return;
		const n = this.activeState.node;
		if (this.d.dragReschedules()) {
			n.z = hit.z + this.activeState.off.z; // gantt: z IS time, set z directly so the bar follows live (the 2D sim ignores fz)
			this.d.updateGhost(n);
		} else {
			n.fx = hit.x + this.activeState.off.x;
			n.fy = hit.y + this.activeState.off.y; // z stays put: it is the recorded-time depth, not a position the user moves
		}
	}

	up(): void {
		const wasClick = !this.activeState && !!this.pendingState; // a press that never crossed the threshold
		this.pendingState = undefined;
		if (wasClick) {
			this.d.setControlsEnabled(true); // re-enable the camera controls; the canvas click listener opens the node's column
			return;
		}
		if (!this.activeState) return;
		const dragged = this.activeState.node;
		for (const n of this.d.nodes()) {
			if (n === dragged || n.id === this.d.selectedId()) continue; // the dragged pin persists; the selected node stays pinned while selected
			n.fx = undefined;
			n.fy = undefined;
			n.fz = undefined;
		}
		this.d.dropDataPin(dragged.id); // the dragged node is now a persistent pin: the next engine-stop release can't clobber it
		this.d.freeze();
		this.d.setControlsEnabled(true);
		this.activeState = undefined;
		this.d.clearGhost();
		this.d.commit(dragged); // gantt: a dragged bar's new z rewrites its scheduled time
	}
}
