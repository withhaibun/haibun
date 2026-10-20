// @vitest-environment jsdom
/**
 * The pointer's events on the canvas: a press on a node is a potential drag, a press with the camera's modifier held orbits
 * the camera and never grabs the node, and a pointer moving over the canvas without a press doesn't move a node. The ray is cast
 * through a stand-in for the scene's THREE that hits every pick target, so each case is the event handling alone.
 */
import { describe, expect, it } from "vitest";
import { PickController, type TPickScene, type TPickThree } from "./pick-controller.js";
import { RenderContext } from "../components/render-context.js";
import type { FGLink, FGNode } from "../domains/graph-types.js";
import type { TSceneCamera } from "../ports.js";

/** A THREE whose ray hits the first pick target it is cast against. */
const hittingThree = (): TPickThree => {
	class Vector3 {
		constructor(
			public x = 0,
			public y = 0,
			public z = 0,
		) {}
		set(x: number, y: number, z: number): void {
			Object.assign(this, { x, y, z });
		}
		project(): Vector3 {
			return this;
		}
	}
	return {
		Raycaster: class {
			camera: unknown;
			ray = { intersectPlane: (_plane: unknown, target: Vector3) => target };
			setFromCamera = (): undefined => undefined;
			intersectObjects(objects: unknown[]): Array<{ object: unknown }> {
				return objects.slice(0, 1).map((object) => ({ object }));
			}
		},
		Plane: class {
			setFromNormalAndCoplanarPoint = (): undefined => undefined;
		},
		Vector2: class {
			constructor(
				public x = 0,
				public y = 0,
			) {}
		},
		Vector3,
	} as unknown as TPickThree;
};

function attached() {
	const target = { position: { x: 0, y: 0, z: 0, set: () => undefined }, scale: { x: 1, y: 1, set: () => undefined } };
	const node: FGNode = { id: "a", name: "a", type: "Email", x: 10, y: 20, z: 0, __visual: { object: target, pickTarget: target } as unknown as FGNode["__visual"] };
	const nodeMap = new Map([[node.id, node]]);
	const canvas = document.createElement("canvas");
	const camera = { updateMatrixWorld: () => undefined, getWorldDirection: () => ({ x: 0, y: 0, z: -1 }) } as unknown as TSceneCamera;
	const world = new RenderContext<FGNode, FGLink>({
		camera: () => camera,
		controls: () => undefined,
		container: () => undefined,
		renderer: () => undefined,
		canvas: () => canvas,
		sceneEl: () => undefined,
		nodeMap: () => nodeMap,
		currentLinks: () => [],
		linkMap: () => new Map(),
	});
	const pick = new PickController({
		world,
		three: hittingThree,
		drag: {
			hold: () => undefined,
			freeze: () => undefined,
			dragReschedules: () => false,
			updateGhost: () => undefined,
			clearGhost: () => undefined,
			commit: () => undefined,
			selectedId: () => null,
			dropDataPin: () => undefined,
		},
		tweening: () => false,
		clicked: () => undefined,
		left: () => undefined,
		markDirty: () => undefined,
		teardown: () => undefined,
	});
	pick.attach(document.createElement("div") as unknown as TPickScene, canvas);
	const press = (init: PointerEventInit) => canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 5, clientY: 5, ...init }));
	return { pick, node, canvas, press };
}

describe("a press on a node", () => {
	it("is a potential drag of that node", () => {
		const { pick, press } = attached();
		press({});
		expect(pick.drag.pendingId).toBe("a");
	});

	it("with the camera's modifier held orbits the camera instead: it doesn't grab the node", () => {
		const { pick, press } = attached();
		press({ ctrlKey: true });
		expect(pick.drag.pendingId).toBeNull();
	});
});

describe("a pointer moving over the canvas without a press", () => {
	it("doesn't move a node or start a drag", () => {
		const { pick, node, canvas } = attached();
		for (let step = 0; step < 16; step++) canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 5 + (step % 2 ? 5 : -5), clientY: 5 + (step % 3 ? 3 : -3) }));
		expect([node.x, node.y, node.z, node.fx]).toEqual([10, 20, 0, undefined]);
		expect(pick.drag.dragging).toBe(false);
		expect(pick.pointerOver).toBe(true);
	});
});
