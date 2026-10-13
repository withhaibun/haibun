/// <reference path="./three-controls.d.ts" />
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TGraphRenderWorld, TGraphRendererSurface, TGraphSceneEl, TSceneCamera } from "../ports.js";

/** The one interface the polymorphic view subsystems read the live render world through. It bundles the late-bound three.js leaf
 * refs (renderer/camera/canvas/container/scene, set at scene-load) AND the shared mutable graph-state collections
 * (nodeMap, currentLinks, linkMap) behind typed getters read at CALL time, so a ref set late (scene-load) or a
 * collection re-fed each repaint (the DataPipeline mutates nodeMap) is always current, never copied. The component
 * still OWNS the refs/maps; this context only exposes them, so the subsystems extracted next read ONE injected
 * context instead of many scattered private-field touches. The decomposition's structural boundary (lovely-finding-babbage). */

/** Accessors the component supplies; every getter is read at CALL time (late-set scene refs / per-repaint maps stay current). */
type RenderContextDeps<TNode, TLink> = TGraphRenderWorld<TNode, TLink>;

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
	get renderer(): TGraphRendererSurface | undefined {
		return this.deps.renderer();
	}
	get canvas(): HTMLCanvasElement | undefined {
		return this.deps.canvas();
	}
	get sceneEl(): TGraphSceneEl | undefined {
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
