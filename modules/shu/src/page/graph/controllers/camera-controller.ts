/// <reference path="../components/three-controls.d.ts" />
/**
 * The camera controller of a graph scene: the reader's orbit controls, the fitting of the frame to the column, following
 * the active node, the framing of a fit or of a node's neighbourhood, and the nudges of a control step or a key. The camera
 * machine owns the arithmetic of every move; this controller starts each move, on what the page and the reader do (SH21,
 * CA3D5).
 */
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { pageClock } from "../../root.js";
import { SHU_ATTR } from "../../../domains/elements.js";
import { FRAME, type FrameMove, type ReframeMode } from "../domains/views.js";
import { isPlaced, type FGLink, type FGNode } from "../domains/graph-types.js";
import { PolymorphicCamera, clearStripOffset, coveredTogether, type GanttExtent } from "../machines/camera.js";
import type { TClientPoint } from "../derivations/project.js";
import type { TWakeCause } from "../../../domains/graph-blips.js";
import type { TSceneCamera } from "../ports.js";
import type { RenderContext } from "../components/render-context.js";

/** How long the camera holds still before a reader's pan or zoom counts as finished: longer than the damping's last visible easing. */
const CAMERA_REST_MS = 150;
/** How long a column's resize settles before the frame takes its size: a column opening animates over many frames. */
const FIT_FRAME_MS = 100;
// three.js MOUSE enum values for OrbitControls.mouseButtons (ROTATE=0, DOLLY=1, PAN=2).
const ORBIT_ROTATE = 0;
const ORBIT_DOLLY = 1;
const ORBIT_PAN = 2;

/** The a-scene slice the controls attach to: its camera, its renderer's canvas, and the camera and rig entities. */
export type TControlsScene = HTMLElement & { camera?: TSceneCamera; renderer?: { domElement: HTMLCanvasElement } };
/** An A-Frame entity, which sets one property of a component it carries. */
type TAframeEntity = HTMLElement & { setAttribute(component: string, prop: string, value: unknown): void };

export type TCameraControllerDeps = {
	world: RenderContext<FGNode, FGLink>;
	/** What fit means for the active view, and where it aims. */
	fitMove: () => FrameMove;
	reframeMode: () => ReframeMode;
	ganttExtent: () => GanttExtent | null;
	sequenceExtent: () => GanttExtent | null;
	/** Whether the layout rests, so a framing now frames where the nodes stop. */
	layoutRests: () => boolean;
	/** The selected node where the graph shows it, else null. */
	activeId: () => string | null;
	follows: () => boolean;
	/** The pixel a node is drawn at, or null before the scene can project it. */
	project: (id: string) => TClientPoint | null;
	/** The scene's reading guide, which covers the canvas while it shows. */
	guide: () => HTMLElement | null;
	sizeRenderer: (width: number, height: number) => void;
	refreshPickBounds: () => void;
	markDirty: (cause: TWakeCause, grace?: number) => void;
	teardown: (end: () => void) => void;
};

export class CameraController {
	/** The arithmetic of every framing, viewport and navigation move. */
	readonly camera: PolymorphicCamera;
	#controls: OrbitControls | undefined;
	/** The node following last aimed at, so a subject that arrives after it was chosen is centred once. */
	#aimedAt: string | null = null;
	#fitFrameTimer: (() => void) | undefined;
	/** The wait for the camera to rest after a reader's pan or zoom, after which following checks the node is in view. */
	#restTimer: (() => void) | undefined;

	constructor(private readonly deps: TCameraControllerDeps) {
		const { world } = deps;
		this.camera = new PolymorphicCamera({
			camera: () => world.camera,
			controls: () => this.#controls,
			container: () => world.container,
			renderer: () => world.renderer,
			canvas: () => world.canvas,
			nodePositions: () => [...world.nodeMap.values()].filter(isPlaced),
			hasNodes: () => world.nodeMap.size > 0,
			reframeMode: deps.reframeMode,
			ganttExtent: deps.ganttExtent,
			sequenceExtent: deps.sequenceExtent,
			refreshPickBounds: deps.refreshPickBounds,
		});
	}

	/** The scene is leaving the page: cancel the waits for a column's resize and for the camera to rest. */
	end(): void {
		this.#fitFrameTimer?.();
		this.#restTimer?.();
	}

	get controls(): OrbitControls | undefined {
		return this.#controls;
	}

	/** Whether the camera moved and hasn't rested, or the column resized and the frame hasn't taken its size, so following
	 *  hasn't checked the node is still in view. */
	get pending(): boolean {
		return this.#restTimer !== undefined || this.#fitFrameTimer !== undefined;
	}

	/**
	 * Desktop navigation: drag pans, Ctrl+drag spins, wheel zooms. A-Frame's look, wasd and movement controls are removed and
	 * the camera rig is flattened to the origin, so OrbitControls moves the camera in world space; WebXR drives the camera
	 * inside a VR session.
	 */
	attach(scene: TControlsScene): OrbitControls {
		const { camera, renderer } = scene;
		const cameraEl = scene.querySelector("[camera]");
		const rigEl = scene.querySelector<TAframeEntity>("[movement-controls]");
		if (!cameraEl || !camera?.position || !renderer?.domElement) throw new Error("CameraController: the scene lacks the camera or the renderer the controls attach to");
		cameraEl.removeAttribute("look-controls");
		cameraEl.removeAttribute("wasd-controls");
		// Disable rather than remove: movement-controls' own loaded/tick handlers still run and crash on a removed component.
		rigEl?.setAttribute("movement-controls", "enabled", false);
		rigEl?.setAttribute("position", "0 0 0");
		camera.position.set(0, 0, 300);
		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.12;
		controls.screenSpacePanning = true;
		// Ctrl/meta/shift-to-orbit is OrbitControls' own behaviour: with LEFT mapped to PAN, a modified press rotates.
		controls.mouseButtons = { LEFT: ORBIT_PAN, MIDDLE: ORBIT_DOLLY, RIGHT: ORBIT_ROTATE };
		this.#controls = controls;
		// Camera motion wakes the on-demand loop: `change` fires each frame the camera still moves, so the scene draws through
		// the damping, then idles. Following checks the node is in view once the camera rests, never during a gesture.
		let gesturing = false;
		controls.addEventListener("start", () => {
			gesturing = true;
			this.deps.markDirty("camera");
		});
		controls.addEventListener("end", () => {
			gesturing = false;
		});
		controls.addEventListener("change", () => {
			this.deps.markDirty("camera", 4);
			this.#restTimer?.();
			this.#restTimer = pageClock().after(CAMERA_REST_MS, () => {
				this.#restTimer = undefined;
				if (!gesturing) this.keepFollowedInView();
			});
		});
		const enterVr = () => {
			controls.enabled = false;
		};
		const exitVr = () => {
			controls.enabled = true;
		};
		scene.addEventListener("enter-vr", enterVr);
		scene.addEventListener("exit-vr", exitVr);
		this.deps.teardown(() => {
			scene.removeEventListener("enter-vr", enterVr);
			scene.removeEventListener("exit-vr", exitVr);
			controls.dispose();
		});
		return controls;
	}

	/** The column's size changed: once its animation settles, size the renderer to it, and keep the followed node in view,
	 *  since a resize moves where the reader can see. */
	fitFrame(container: HTMLElement): void {
		this.#fitFrameTimer?.();
		this.#fitFrameTimer = pageClock().after(FIT_FRAME_MS, () => {
			this.#fitFrameTimer = undefined;
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w && h) this.deps.sizeRenderer(w, h);
			this.keepFollowedInView();
		});
	}

	/**
	 * Hold the followed node where a reader can see it: inside the canvas and clear of whatever covers it, at the zoom the
	 * reader set. A node already in view stays where it is, so a pan that keeps it on screen stands; a subject chosen
	 * before the graph held it is centred once it arrives.
	 */
	keepFollowedInView(): void {
		const id = this.deps.activeId();
		if (!this.deps.follows() || id === null) return;
		if (this.#aimedAt !== id || !this.#inClearView(id)) this.follow(id);
	}

	/** Centre a node, holding the reader's zoom level, in the clear part of the canvas. A node the layout hasn't placed is
	 *  followed once it is. */
	follow(nodeId: string): void {
		const n = this.deps.world.nodeMap.get(nodeId);
		if (n === undefined || !isPlaced(n)) return;
		this.#aimedAt = nodeId;
		const canvas = this.deps.world.canvas?.getBoundingClientRect();
		const covered = canvas === undefined ? null : this.#coveredRect(canvas);
		this.camera.centerOn(n, canvas === undefined || covered === null ? undefined : (clearStripOffset(canvas, covered) ?? undefined));
	}

	/** An overlay opened or closed, which changes the clear part of the canvas: aim the followed node there again. */
	coverChanged(): void {
		const id = this.deps.activeId();
		if (this.deps.follows() && id !== null) this.follow(id);
	}

	/** The layout came to rest: apply a queued framing, and keep the followed node in view, since the layout may have moved
	 *  it or brought it into the graph. */
	settled(): void {
		this.camera.applyPendingFrame();
		this.keepFollowedInView();
	}

	/** Fit the whole graph as the active view defines fit. While the layout moves the fit waits for the settle, since
	 *  framing now would frame where the nodes are, not where they stop. */
	fit(): void {
		const move = this.deps.fitMove();
		if (this.deps.layoutRests()) this.camera.frame(move);
		else this.camera.queueFrame(move);
	}

	/** Frame the nodes `ids` names that the graph holds and has placed; the camera stays where the graph hasn't placed any of them. */
	fitNodes(ids: readonly string[]): void {
		const { nodeMap } = this.deps.world;
		const positions = ids.flatMap((id) => {
			const n = nodeMap.get(id);
			return n !== undefined && isPlaced(n) ? [n] : [];
		});
		if (positions.length > 0) this.camera.fitPositions(positions);
	}

	/** Rotate to a head-on aim: `xy` faces the layout plane, `z` faces the depth axis, so time reads left to right. */
	rotateTo(aim: "xy" | "z"): void {
		this.camera.frame(aim === "xy" ? FRAME.front : FRAME.side);
	}

	/** Whether a node draws inside the canvas and outside everything covering it. A node the scene can't project yet counts
	 *  as in view, so the camera doesn't move. */
	#inClearView(id: string): boolean {
		const at = this.deps.project(id);
		const canvas = this.deps.world.canvas?.getBoundingClientRect();
		if (!at || !canvas) return true;
		if (at.x < canvas.left || at.x > canvas.right || at.y < canvas.top || at.y > canvas.bottom) return false;
		const covered = this.#coveredRect(canvas);
		return !covered || at.x < covered.left || at.x > covered.right || at.y < covered.top || at.y > covered.bottom;
	}

	/** The part of the canvas something covers: the reading guide while it shows, and every overlay on the page that declares
	 *  it covers the views, boxed together. */
	#coveredRect(canvas: DOMRect): ReturnType<typeof coveredTogether> {
		const guide = this.deps.guide();
		const showing = guide && (guide.hasAttribute("data-shown") || guide.matches(":focus-within")) ? [guide] : [];
		const declared = Array.from(document.querySelectorAll<HTMLElement>(`[${SHU_ATTR.DATA_COVERS_VIEWS}]`));
		return coveredTogether(
			canvas,
			[...showing, ...declared].map((el) => el.getBoundingClientRect()),
		);
	}
}
