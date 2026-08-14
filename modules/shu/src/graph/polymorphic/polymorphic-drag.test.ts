import { describe, expect, it } from "vitest";
import { NodeDrag, type NodeDragDeps } from "./polymorphic-drag.js";
import type { FGNode } from "./polymorphic-graph-types.js";

const node = (id: string, x: number, y: number, z = 0): FGNode => ({ id, x, y, z }) as FGNode;
const evt = (x: number, y: number): PointerEvent => ({ clientX: x, clientY: y }) as PointerEvent;

function setup(over: Partial<NodeDragDeps> = {}) {
	const nodes = [node("X", 10, 20), node("Y", 5, 5), node("Z", -3, 8)];
	const calls = { held: false, frozen: false, controls: true, droppedPin: "", ghost: 0, cleared: 0, committed: "" };
	// planeHit stub: the pointer's client coords ARE the world hit — the test drives the geometry directly, no THREE.
	const deps: NodeDragDeps = {
		pick: () => nodes[0],
		makePlane: () => ({}),
		planeHit: (e) => ({ x: e.clientX, y: e.clientY, z: 0 }),
		nodes: () => nodes,
		hold: () => {
			calls.held = true;
		},
		freeze: () => {
			calls.frozen = true;
		},
		setControlsEnabled: (on) => {
			calls.controls = on;
		},
		dragReschedules: () => false,
		updateGhost: () => {
			calls.ghost++;
		},
		clearGhost: () => {
			calls.cleared++;
		},
		commit: (n) => {
			calls.committed = n.id;
		},
		selectedId: () => null,
		dropDataPin: (id) => {
			calls.droppedPin = id;
		},
		...over,
	};
	return { nodes, calls, drag: new NodeDrag(deps) };
}

describe("NodeDrag", () => {
	it("a press then a real drag: the node tracks the pointer, every node pins, then only the dragged stays pinned", () => {
		const { nodes, calls, drag } = setup();
		drag.down(evt(0, 0)); // hit0 = (0,0) → off = node.pos = (10,20)
		expect(calls.controls).toBe(false); // controls off on press…
		expect(drag.pendingId).toBe("X"); // …but not a drag yet (a still press is a click)
		expect(drag.dragging).toBe(false);
		drag.move(evt(20, 30)); // hypot(20,30) > 5 → promote to a drag
		expect(drag.dragging).toBe(true);
		expect(calls.held).toBe(true); // engine held
		expect(nodes[1].fx).toBe(5); // Y pinned at its own position for the duration
		expect(nodes[2].fx).toBe(-3); // Z pinned
		expect(nodes[0].fx).toBe(30); // X tracks: hit1.x (20) + off.x (10)
		expect(nodes[0].fy).toBe(50); // hit1.y (30) + off.y (20)
		drag.up();
		expect(calls.frozen).toBe(true);
		expect(calls.controls).toBe(true); // camera controls re-enabled
		expect(nodes[1].fx).toBeUndefined(); // Y released
		expect(nodes[2].fx).toBeUndefined(); // Z released
		expect(nodes[0].fx).toBe(30); // the dragged node's pin PERSISTS
		expect(calls.droppedPin).toBe("X"); // and it leaves the transient data-pin set
	});

	it("a press that never crosses the threshold is a click, not a drag: nothing pins, camera controls stay enabled", () => {
		const { nodes, calls, drag } = setup();
		drag.down(evt(100, 100));
		drag.move(evt(102, 103)); // hypot(2,3) < 5 → still a click
		expect(drag.dragging).toBe(false);
		expect(calls.held).toBe(false);
		expect(nodes[0].fx).toBeUndefined(); // nothing pinned
		drag.up();
		expect(calls.controls).toBe(true); // camera controls re-enabled for the click
		expect(calls.frozen).toBe(false); // no drag to freeze
	});

	it("the selected node keeps its pin through a drag release", () => {
		const { nodes, drag } = setup({ selectedId: () => "Y" });
		drag.down(evt(0, 0));
		drag.move(evt(20, 30));
		drag.up();
		expect(nodes[1].fx).toBe(5); // Y (selected) keeps its pin
		expect(nodes[2].fx).toBeUndefined(); // Z (unselected, undragged) released
	});

	it("a reschedule (gantt) drag slides z, keeps the lane (x/y) pinned, and commits on release", () => {
		const { nodes, calls, drag } = setup({ dragReschedules: () => true, planeHit: (e) => ({ x: e.clientX, y: e.clientY, z: e.clientY }) });
		drag.down(evt(0, 0)); // hit0 z=0 → off.z = 0
		drag.move(evt(20, 30)); // hit1 z=30 → node.z = 30
		expect(nodes[0].z).toBe(30); // slid along the time axis
		expect(nodes[0].fx).toBe(10); // lane pinned (x/y held), NOT dragged to the pointer
		expect(calls.ghost).toBeGreaterThan(0);
		drag.up();
		expect(calls.committed).toBe("X"); // the new schedule is committed
		expect(calls.cleared).toBe(1);
	});
});
