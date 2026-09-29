import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vec3 } from "./polymorphic-enclosure.js";

/** The one interface the polymorphic view subsystems read the live render world through. It bundles the late-bound three.js leaf
 * refs (renderer/camera/canvas/container/scene, set at scene-load) AND the shared mutable graph-state collections
 * (nodeMap, currentLinks, linkMap) behind typed getters read at CALL time, so a ref set late (scene-load) or a
 * collection re-fed each repaint (the DataPipeline mutates nodeMap) is always current, never copied. The component
 * still OWNS the refs/maps; this context only exposes them, so the subsystems extracted next read ONE injected
 * context instead of many scattered private-field touches. The decomposition's structural boundary (lovely-finding-babbage). */

/** The slice of the three.js camera the view drives: its framing, where it sits, and what it looks at (structural: this
 *  module doesn't depend on a three .d.ts). */
export type TSceneCamera = {
	aspect: number;
	fov?: number;
	position?: Vec3;
	updateProjectionMatrix(): void;
	getWorldDirection?(target: Vec3): Vec3;
	matrixWorld?: { elements: number[] }; // columns 0/1 = the camera's right/up axes, for screen-oriented placement
	updateMatrixWorld?(force?: boolean): void;
	/** The camera's orientation, which a chip copies to face it. */
	quaternion?: { x: number; y: number; z: number; w: number };
};
type RcRenderer = { setSize(w: number, h: number, updateStyle: boolean): void; getPixelRatio(): number; xr?: { isPresenting?: boolean } };
type RcSceneEl = HTMLElement & { emit(name: string, detail?: unknown, bubbles?: boolean): void };

/** Accessors the component supplies; every getter is read at CALL time (late-set scene refs / per-repaint maps stay current). */
type RenderContextDeps<TNode, TLink> = {
	camera: () => TSceneCamera | undefined;
	controls: () => OrbitControls | undefined;
	container: () => HTMLElement | undefined;
	renderer: () => RcRenderer | undefined;
	canvas: () => HTMLCanvasElement | undefined;
	sceneEl: () => RcSceneEl | undefined;
	nodeMap: () => Map<string, TNode>;
	currentLinks: () => TLink[];
	linkMap: () => Map<string, TLink>;
};

export class RenderContext<TNode, TLink> {
	constructor(private deps: RenderContextDeps<TNode, TLink>) {}

	get camera(): TSceneCamera | undefined {
		return this.deps.camera();
	}
	get controls(): OrbitControls | undefined {
		return this.deps.controls();
	}
	get container(): HTMLElement | undefined {
		return this.deps.container();
	}
	get renderer(): RcRenderer | undefined {
		return this.deps.renderer();
	}
	get canvas(): HTMLCanvasElement | undefined {
		return this.deps.canvas();
	}
	get sceneEl(): RcSceneEl | undefined {
		return this.deps.sceneEl();
	}
	get nodeMap(): Map<string, TNode> {
		return this.deps.nodeMap();
	}
	get currentLinks(): TLink[] {
		return this.deps.currentLinks();
	}
	get linkMap(): Map<string, TLink> {
		return this.deps.linkMap();
	}
}
