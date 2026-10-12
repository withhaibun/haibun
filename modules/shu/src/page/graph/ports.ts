/**
 * The ports of the graph view. `page/graph/root.ts` builds the frame loop, the engine pacing, the frame timing and the
 * context document, one set per scene; the scene's parts read the renderer contract and the render world as types. The
 * scene requests every timer and frame through the page's clock and observes its size through the page's observer, so the
 * scene and its parts perform no I/O.
 */
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Vec3 } from "../../graph/polymorphic/polymorphic-enclosure.js";
import type { FGLink, FGNode } from "./domains/graph-types.js";

/** What the scene displays each repaint: the pipeline's own output. */
export type TDrawn = { nodes: FGNode[]; links: FGLink[] };

/** What a medium must do to show a graph. Every repaint calls `draw`, so a renderer that records what it was given uses
 *  the same path as one that displays it. A renderer doesn't hold a second model: it is handed what the pipeline already
 *  produced, and what it displayed is read back through the scene's own snapshot. */
export type TGraphRenderer = {
	size(width: number, height: number): void;
	draw(drawn: TDrawn): void;
	/** The node shapes changed kind (a chip became a bar), not just their places. */
	rebuildNodes(): void;
};

/** A 4x4 matrix's 16 entries, column-major, as three.js holds them in `Matrix4.elements`. */
export type TMatrix4Elements = [
	number, number, number, number,
	number, number, number, number,
	number, number, number, number,
	number, number, number, number,
];

/** The slice of the three.js camera the view drives: its framing, where it sits, and what it looks at. */
export type TSceneCamera = {
	aspect: number;
	fov?: number;
	position?: Vec3;
	updateProjectionMatrix(): void;
	getWorldDirection?(target: Vec3): Vec3;
	/** Columns 0/1 are the camera's right and up axes, for screen-oriented placement. */
	matrixWorld?: { elements: TMatrix4Elements };
	updateMatrixWorld?(force?: boolean): void;
	/** The camera's orientation, which a chip copies to face it. */
	quaternion?: { x: number; y: number; z: number; w: number };
};

/** The slice of the renderer the view sizes and reads: its sizing, its pixel ratio, and its XR state. */
export type TGraphRendererSurface = { setSize(w: number, h: number, updateStyle: boolean): void; getPixelRatio(): number; xr?: { isPresenting?: boolean } };

/** The scene element the view drives: an element that emits. */
export type TGraphSceneEl = HTMLElement & { emit(name: string, detail?: unknown, bubbles?: boolean): void };

/** The render world: the late-bound leaf refs (set at scene-load) and the shared mutable graph-state collections (re-fed
 *  each repaint), behind call-time getters, so a ref set late or a collection re-fed each repaint is always current, never
 *  copied. The scene owns the refs and maps; the world only exposes them. */
export type TGraphRenderWorld<TNode, TLink> = {
	camera: () => TSceneCamera | undefined;
	controls: () => OrbitControls | undefined;
	container: () => HTMLElement | undefined;
	renderer: () => TGraphRendererSurface | undefined;
	canvas: () => HTMLCanvasElement | undefined;
	sceneEl: () => TGraphSceneEl | undefined;
	nodeMap: () => Map<string, TNode>;
	currentLinks: () => TLink[];
	linkMap: () => Map<string, TLink>;
};

/** The library engine's pacing, which the governor applies synchronously. */
export type TGraphEnginePacing = { cooldownTicks(n: number): unknown; cooldownTime(ms: number): unknown; d3ReheatSimulation(): unknown };

/** The engine's modes: what it is doing, observable. */
export type TGraphEngineMode = "idle" | "settling" | "holding" | "frozen";

/** The engine: what a scene does to the library engine's pacing. Every consumer states intent: settle after a data feed,
 *  hold for a tween or drag, freeze at rest. "Who controls the engine" has one answer, and the mode is observable. */
export type TGraphEngine = {
	readonly mode: TGraphEngineMode;
	attach(graph: TGraphEnginePacing): void;
	/** A placed feed landed: tick briefly so the sprites reach their positions, then rest. */
	settle(): void;
	/** A tween or drag needs the engine ticking continuously (pins are applied per tick); `freeze` ends it. */
	hold(): void;
	/** Stop ticking now; the positions are where they should be. */
	freeze(): void;
	/** Wired to the library's engine-stop: records that the engine rests, and returns whether this stop ended motion. */
	engineStopped(): boolean;
};

/** The frame loop: the gate that runs the media's render loop while something moves and stops it at rest. The scene
 *  reports each frame whether anything moves, and a frame that reports what the last one did doesn't change the loop. */
export type TGraphFrameLoop = {
	/** Whether the scene is drawing now. */
	readonly drawing: boolean;
	moving(isMoving: boolean): void;
	/** The scene is going away: stop drawing whatever the last frame rendered. */
	end(): void;
};

/** The frame timing: what a drawn frame takes the renderer, measured from the page without stalling it. A WebGL2 fence
 *  placed after the draw signals when the GPU's work is complete; polling it on later frames doesn't block them. A
 *  context without fences measures nothing, and the regulator that reads this then never trips. */
export type TGraphFrameTime = {
	/** A frame was drawn: a fence is placed after it where a measurement is due. */
	drew(): void;
	/** Returns the time of a completed measurement once, in milliseconds, and undefined otherwise. Polled each tick. */
	poll(): number | undefined;
	/** The scene is going away: a pending fence is released. */
	end(): void;
};

/** The context document: what the graph view reads of its JSON-LD context, by the address the page serves it at. */
export type TGraphContextDocument = {
	/** Reads the context document at `address` and returns its `@context`, or undefined where it holds none. */
	read(address: string): Promise<Record<string, unknown> | undefined>;
};

/** The size observer: what an element's size changes report. `observe` watches the element's box and fires `onResize`
 *  when it changes, returning a cancel that stops the observation. The view that owns the element reads this. */
export type TSizeObserver = {
	observe(target: Element, onResize: () => void): () => void;
};
