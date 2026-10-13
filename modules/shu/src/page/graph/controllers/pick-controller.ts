/**
 * The pick controller of a graph scene: which node a press, a click or a projection names, and a node's drag. A pick casts
 * a ray from the pointer through the camera against each node's pick target at its resting size; a projection runs the
 * same camera the other way, so a pick lands on the node a projection names. The drag machine holds a drag's states and
 * pins; this controller owns the pointer's events and the ray geometry it hands that machine (SH21, CA3D5).
 */
import { NodeDrag, DRAG_THRESHOLD_PX, type NodeDragDeps } from "../machines/node-drag.js";
import { clientToNdc, ndcToClient, screenShare, type TClientPoint, type TScreenShare } from "../derivations/project.js";
import { isPlaced, type FGLink, type FGNode } from "../domains/graph-types.js";
import type { TWakeCause } from "../../../domains/graph-blips.js";
import type { RenderContext } from "../components/render-context.js";

type Vec3 = { x: number; y: number; z: number };
type TPlane = { setFromNormalAndCoplanarPoint(normal: Vec3, point: Vec3): unknown };
type TRay = {
	camera: unknown;
	setFromCamera(coords: { x: number; y: number }, camera: unknown): void;
	ray: { intersectPlane(plane: TPlane, target: Vec3): Vec3 | null };
	intersectObjects(objects: unknown[], recursive?: boolean): Array<{ object: unknown }>;
};
/** The slice of A-Frame's THREE a pick constructs: a ray from the pointer, the plane a drag slides along, and the points
 *  a projection carries through the camera. */
export type TPickThree = {
	Raycaster: new () => TRay;
	Plane: new () => TPlane;
	Vector2: new (x?: number, y?: number) => { x: number; y: number };
	Vector3: new (x?: number, y?: number, z?: number) => Vec3 & { set(x: number, y: number, z: number): void; project(camera: unknown): Vec3 };
};

/** The pick-target side: the fields a pick writes, and the matrix it must re-derive. */
export type TPickObject = {
	position?: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
	scale: { x: number; y: number; set(x: number, y: number, z: number): void };
	updateMatrixWorld?: (force?: boolean) => void;
};
/** The node side: the engine's position of the node, and its resting size. */
type TPickNode = { x: number; y: number; z: number; baseScale?: { x: number; y: number } };
/** A scale to put back after the raycast: the live magnify, replaced by the resting size while picking. */
export type TScaleRestore = { x: number; y: number };

/**
 * Point `object` at the node's engine coordinates and its resting size, then re-derive its matrix. Returns the scale the
 * caller restores after the raycast (the live magnify), or null when the object kept its size.
 *
 * A raycast reads an object's matrix, which the next render derives from the fields the layout and the magnify write, so
 * between a write and the next frame the matrix is one frame behind and a pick misses every node. The matrix is
 * re-derived on every pick, whether or not anything moved. Picking at the resting size keeps a magnified node's hittable
 * area from growing with its pop, which would capture presses aimed around it.
 */
export function syncPickTarget(object: TPickObject, node: TPickNode): TScaleRestore | null {
	const { x, y, z } = node;
	if (object.position && (object.position.x !== x || object.position.y !== y || object.position.z !== z)) object.position.set(x, y, z);
	let restore: TScaleRestore | null = null;
	const base = node.baseScale;
	if (base && (object.scale.x !== base.x || object.scale.y !== base.y)) {
		restore = { x: object.scale.x, y: object.scale.y };
		object.scale.set(base.x, base.y, 1);
	}
	object.updateMatrixWorld?.(true);
	return restore;
}

/** Put a magnified scale back after the raycast, re-deriving the matrix so the next frame draws the pop unchanged. */
export function restorePickTarget(object: TPickObject, scale: TScaleRestore): void {
	object.scale.set(scale.x, scale.y, 1);
	object.updateMatrixWorld?.(true);
}

/** The a-scene slice a pick reads: its raycasting entities, the camera A-Frame makes active, and the events it emits. */
export type TPickScene = HTMLElement & { camera?: unknown; emit(name: string, detail?: unknown, bubbles?: boolean): void };

export type TPickControllerDeps = {
	world: RenderContext<FGNode, FGLink>;
	three: () => TPickThree | undefined;
	/** The drag's hooks into the scene: the engine, the gantt reschedule, and the pins a drop leaves. */
	drag: Omit<NodeDragDeps, "pick" | "makePlane" | "planeHit" | "nodes" | "setControlsEnabled">;
	/** Whether a layout tween owns the nodes, so a press doesn't start a drag. */
	tweening: () => boolean;
	/** A click that didn't move past the drag threshold: on the node the press picked, or on empty space. */
	clicked: (node: FGNode | undefined, e: MouseEvent) => void;
	/** The pointer left the canvas, so a hover it caused ends. */
	left: () => void;
	markDirty: (cause: TWakeCause) => void;
	teardown: (end: () => void) => void;
};

export class PickController {
	readonly drag: NodeDrag;
	/** Whether a pointer is over the canvas: a hover counts only then, since the cursor raycasts its last position. */
	#pointerOver = false;
	#lastCanvasPos: { left: number; top: number; width: number; height: number } | undefined;

	constructor(private readonly deps: TPickControllerDeps) {
		this.drag = new NodeDrag({
			...deps.drag,
			pick: (e) => this.#pickNodeAt(e),
			makePlane: (n) => this.#dragPlaneFor(n),
			planeHit: (e, plane) => (plane ? this.#pointerPlaneHit(e, plane as TPlane) : null),
			nodes: () => deps.world.nodeMap.values(),
			setControlsEnabled: (on) => {
				const controls = deps.world.controls;
				if (controls) controls.enabled = on;
			},
		});
	}

	get pointerOver(): boolean {
		return this.#pointerOver;
	}

	/** Attach the pointer's events to the canvas: a click opens the node its press picked, and a press on a node drags it. */
	attach(scene: TPickScene, canvas: HTMLCanvasElement): void {
		this.#enableSpriteRaycast(scene);
		let pressed: { x: number; y: number; node: FGNode | undefined } | null = null;
		// The pick runs at the press, because document click listeners run before this one and can move the camera.
		const onPress = (e: PointerEvent) => {
			pressed = { x: e.clientX, y: e.clientY, node: this.#pickNodeAt(e) };
		};
		const onClick = (e: MouseEvent) => {
			const press = pressed;
			pressed = null;
			if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD_PX) return;
			this.deps.clicked(press.node, e);
		};
		// Ctrl/meta is the camera's modifier: a modified press orbits, even over a chip, so a dense graph leaves a pixel from
		// which the camera rotates. A press during a tween or a drag is ignored.
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || this.deps.tweening() || this.drag.dragging || e.ctrlKey || e.metaKey) return;
			this.drag.down(e);
			if (this.drag.pendingId === null) return;
			try {
				canvas.setPointerCapture(e.pointerId); // keeps moves flowing outside the canvas
			} catch {
				// A synthetic pointer lacks a capturable id; the drag then stays within the canvas.
			}
		};
		// Any move over the canvas shows the pointer is there: an enter misses a page that loads under the pointer.
		const onMove = (e: PointerEvent) => {
			this.#pointerOver = true;
			this.deps.markDirty("pointer");
			this.drag.move(e);
		};
		const onUp = () => this.drag.up();
		const onEnter = () => {
			this.#pointerOver = true;
			this.deps.markDirty("pointer");
		};
		const onLeave = () => {
			this.#pointerOver = false;
			this.deps.markDirty("focus"); // draw the hover magnify easing out after the pointer leaves
			this.deps.left();
		};
		// Capture phase: a press on a node disables the controls before OrbitControls' own pointerdown starts a pan.
		const listeners: Array<[string, (e: never) => void, boolean]> = [
			["pointerdown", onPress, false],
			["click", onClick, false],
			["pointerdown", onDown, true],
			["pointermove", onMove, false],
			["pointerup", onUp, false],
			["pointercancel", onUp, false],
			["pointerenter", onEnter, false],
			["pointerleave", onLeave, false],
		];
		for (const [type, listener, capture] of listeners) canvas.addEventListener(type, listener as EventListener, capture);
		this.deps.teardown(() => {
			for (const [type, listener, capture] of listeners) canvas.removeEventListener(type, listener as EventListener, capture);
		});
	}

	/** Which node a press at these client pixels picks, without a pointer's side effects. */
	pickAt(clientX: number, clientY: number): string | null {
		const picked = this.#pickNodeAt({ clientX, clientY } as MouseEvent);
		return picked === undefined ? null : picked.id;
	}

	/** The pixel a node is drawn at, through the camera with its matrix current, as the pick's ray is. Null before the scene
	 *  holds a camera and a canvas, or for an id the graph lacks. */
	project(id: string): TClientPoint | null {
		const T = this.deps.three();
		const { camera, canvas, nodeMap } = this.deps.world;
		const n = nodeMap.get(id);
		if (!T || !camera || !canvas || n === undefined || !isPlaced(n)) return null;
		camera.updateMatrixWorld?.(true);
		return ndcToClient(new T.Vector3(n.x, n.y, n.z).project(camera), canvas.getBoundingClientRect());
	}

	/** The share of the nodes the camera shows inside the canvas, or null before the scene holds a camera. */
	screenShare(): TScreenShare | null {
		const T = this.deps.three();
		const camera = this.deps.world.camera;
		if (!T || !camera) return null;
		camera.updateMatrixWorld?.(true);
		return screenShare([...this.deps.world.nodeMap.values()].filter(isPlaced).map((n) => new T.Vector3(n.x, n.y, n.z).project(camera)));
	}

	/**
	 * A-Frame's cursor caches the canvas bounds and refreshes them on a window resize or scroll, or a debounced renderer
	 * resize, all of which miss a column's change of layout, so picks would land offset. Write the fresh bounds into the
	 * cursors, and emit the renderer resize for anything else listening.
	 */
	refreshBounds(): void {
		const { sceneEl, canvas } = this.deps.world;
		if (!sceneEl || !canvas) return;
		const bounds = canvas.getBoundingClientRect();
		type CursorEl = HTMLElement & { components?: { cursor?: { canvasBounds: DOMRect } } };
		for (const el of Array.from(sceneEl.querySelectorAll<CursorEl>("[cursor]"))) {
			const cursor = el.components?.cursor;
			if (cursor) cursor.canvasBounds = bounds;
		}
		sceneEl.emit("rendererresize", null, false);
	}

	/**
	 * Compare the canvas's place with the last sample, in whole pixels so subpixel jitter doesn't refresh in a loop. A move
	 * (a strip scrolled, a column opened) refreshes the pick bounds, and returns whether the size changed too, which the
	 * scene draws again at its new aspect.
	 */
	canvasResized(): boolean {
		const canvas = this.deps.world.canvas;
		if (!canvas) return false;
		const b = canvas.getBoundingClientRect();
		const r = { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) };
		const prev = this.#lastCanvasPos;
		this.#lastCanvasPos = r;
		if (!prev || (prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height)) return false;
		this.refreshBounds();
		return prev.width !== r.width || prev.height !== r.height;
	}

	/** A ray from the pointer through the camera, built from a current camera matrix: a pick can run between frames, after
	 *  a reframe the render hasn't drawn, and a stale matrix misses every node. */
	#pointerRay(e: MouseEvent): TRay | null {
		const T = this.deps.three();
		const { canvas, camera } = this.deps.world;
		if (!T || !canvas || !camera) return null;
		camera.updateMatrixWorld?.(true);
		const n = clientToNdc({ x: e.clientX, y: e.clientY }, canvas.getBoundingClientRect());
		const ray = new T.Raycaster();
		ray.setFromCamera(new T.Vector2(n.x, n.y), camera);
		ray.camera = camera; // Sprite.raycast needs the camera reference (billboard math)
		return ray;
	}

	/** Where the pointer ray crosses the plane, in graph coordinates, or null when the ray misses it at a grazing angle. */
	#pointerPlaneHit(e: PointerEvent, plane: TPlane): Vec3 | null {
		const T = this.deps.three();
		const ray = this.#pointerRay(e);
		return T && ray ? ray.ray.intersectPlane(plane, new T.Vector3()) : null;
	}

	/** The node whose pick target is under the pointer, cast at the press so a drag or an orbit never waits on the cursor's
	 *  hover, against each node's resting footprint, so a focused node's pop never widens its grab zone. */
	#pickNodeAt(e: MouseEvent): FGNode | undefined {
		const ray = this.#pointerRay(e);
		if (!ray) return undefined;
		const targetToNode = new Map<unknown, FGNode>();
		const restore: Array<[TPickObject, TScaleRestore]> = [];
		for (const n of this.deps.world.nodeMap.values()) {
			const visual = n.__visual;
			if (!visual || !isPlaced(n)) continue;
			targetToNode.set(visual.pickTarget, n);
			const magnified = syncPickTarget(visual.object as TPickObject, { x: n.x, y: n.y, z: n.z, baseScale: n.__baseScale });
			if (magnified) restore.push([visual.object as TPickObject, magnified]);
		}
		const hit = ray.intersectObjects([...targetToNode.keys()], false)[0];
		for (const [object, scale] of restore) restorePickTarget(object, scale);
		return hit ? targetToNode.get(hit.object) : undefined;
	}

	/** The camera-facing plane through a node, fixed at the press: the surface a drag slides the node along. Null before the
	 *  scene holds THREE and a camera, so a drag doesn't start. */
	#dragPlaneFor(node: FGNode): TPlane | null {
		const T = this.deps.three();
		const dir = T && this.deps.world.camera?.getWorldDirection?.(new T.Vector3());
		if (!T || !dir || !isPlaced(node)) return null;
		const plane = new T.Plane();
		plane.setFromNormalAndCoplanarPoint(dir, new T.Vector3(node.x, node.y, node.z));
		return plane;
	}

	/** A-Frame's raycaster aims by origin and direction and never sets its THREE raycaster's camera, which a sprite's raycast
	 *  needs: point every cursor's raycaster at the active camera. */
	#enableSpriteRaycast(scene: TPickScene): void {
		type RaycasterEl = HTMLElement & { components?: { raycaster?: { raycaster: { camera: unknown } } } };
		const apply = (camera: unknown) => {
			for (const el of Array.from(scene.querySelectorAll<RaycasterEl>("[raycaster]"))) {
				const rc = el.components?.raycaster?.raycaster;
				if (rc) rc.camera = camera;
			}
		};
		apply(scene.camera);
		const onCameraSet = (e: Event) => apply((e as CustomEvent<{ cameraEl: { components: { camera: { camera: unknown } } } }>).detail.cameraEl.components.camera.camera);
		scene.addEventListener("camera-set-active", onCameraSet);
		this.deps.teardown(() => scene.removeEventListener("camera-set-active", onCameraSet));
	}
}
