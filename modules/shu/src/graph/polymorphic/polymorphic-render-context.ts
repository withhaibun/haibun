import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** The one interface the polymorphic view subsystems read the live render world through. It bundles the late-bound three.js leaf
 * refs (renderer/camera/canvas/container/scene, set at scene-load) AND the shared mutable graph-state collections
 * (nodeMap, currentLinks, linkMap) behind typed getters read at CALL time — so a ref set late (scene-load) or a
 * collection re-fed each repaint (the DataPipeline mutates nodeMap) is always current, never copied. The component
 * still OWNS the refs/maps; this context only exposes them, so the subsystems extracted next read ONE injected
 * context instead of many scattered private-field touches. The decomposition's structural boundary (lovely-finding-babbage). */

type Vec3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): void };

/** The three.js camera slice the view drives (structural — this module keeps depending on no three .d.ts). */
export type RcCamera = {
	aspect: number;
	fov?: number;
	position?: { x: number; y: number; z: number };
	updateProjectionMatrix(): void;
	getWorldDirection?(target: Vec3): Vec3;
	matrixWorld?: { elements: number[] };
};
export type RcRenderer = { setSize(w: number, h: number, updateStyle: boolean): void; getPixelRatio(): number; xr?: { isPresenting?: boolean } };
export type RcSceneEl = HTMLElement & { emit(name: string, detail?: unknown, bubbles?: boolean): void };

/** Accessors the component supplies; every getter is read at CALL time (late-set scene refs / per-repaint maps stay current). */
export type RenderContextDeps<TNode, TLink> = {
	camera: () => RcCamera | undefined;
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

	get camera(): RcCamera | undefined {
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
