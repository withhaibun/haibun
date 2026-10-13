/**
 * The graph view's composition root. It builds the graph view's ports, one set per scene, for the scene and the views
 * that read them: the frame loop a scene draws with, the engine that paces its graph, and the frame timing it measures
 * with; and, once for the page, the JSON-LD context document. The scene passes itself as the I/O it needs (the A-Frame
 * scene it hosts, the WebGL context its renderer makes, and the page's clock), and doesn't perform I/O itself.
 */
import { pagePinned } from "../adapters/page-held.js";
import { contextDocument } from "./adapters/context-document.js";
import { EngineGovernor } from "./adapters/engine.js";
import { aframeLoop, Drawing, type TAframeScene } from "./adapters/frame-loop.js";
import { FrameTime, type TFenceGl } from "./adapters/frame-time.js";
import type { TGraphContextDocument, TGraphEngine, TGraphFrameLoop, TGraphFrameTime } from "./ports.js";

const CONTEXT_DOCUMENT_KEY = "__SHU_GRAPH_CONTEXT_DOCUMENT__";

/** The frame loop a scene draws with, built for one scene: the gate that runs the media's render loop while something
 *  moves, driven by the scene's own bound render. `afterDraw` places the frame timing's fence after each drawn frame. */
export const graphFrameLoop = (scene: TAframeScene, afterDraw: () => void): TGraphFrameLoop => new Drawing(aframeLoop(scene, afterDraw));

/** The engine that paces a scene's graph, built for one scene. */
export const graphEngine = (): TGraphEngine => new EngineGovernor();

/** The frame timing a scene measures with, built for one scene. `webgl` reads the scene's WebGL context lazily, since its
 *  renderer exists only after the scene has loaded; `now` is the page's clock. */
export const graphFrameTime = (webgl: () => TFenceGl | undefined, windowSamples: number, now: () => number): TGraphFrameTime => new FrameTime(webgl, windowSamples, now);

/** The graph's JSON-LD context document, held by the page: one reader of the served context, shared by every view that
 *  scopes it to the type it shows. */
export const pageGraphContextDocument = (): TGraphContextDocument => pagePinned(CONTEXT_DOCUMENT_KEY, contextDocument);
