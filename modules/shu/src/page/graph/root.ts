/**
 * The graph view's composition root. It builds the graph view's ports, one set per scene, for the scene and the views
 * that read them. The scene draws with a frame loop it gets here, paces its graph with an engine it gets here, and
 * measures its frames with a frame timing it gets here; a view that needs the graph's JSON-LD context reads it from here.
 * The scene passes itself as the I/O it needs (the A-Frame scene it hosts and the WebGL context its renderer makes), and
 * performs no I/O itself.
 */
import { contextDocument } from "./adapters/context-document.js";
import { sizeObserver } from "./adapters/size-observer.js";
import { EngineGovernor } from "./adapters/engine.js";
import { aframeLoop, Drawing, TAframeScene } from "./adapters/frame-loop.js";
import { FrameTime, TFenceGl } from "./adapters/frame-time.js";
import type { TGraphContextDocument, TGraphEngine, TGraphFrameLoop, TGraphFrameTime, TSizeObserver } from "./ports.js";

/** The frame loop a scene draws with, built for one scene: the gate that runs the media's render loop while something
 *  moves, driven by the scene's own bound render. `afterDraw` is the frame timing's fence placement. */
export function graphFrameLoop(scene: TAframeScene, afterDraw?: () => void): TGraphFrameLoop {
	return new Drawing(aframeLoop(scene, afterDraw));
}

/** The engine that paces a scene's graph, built for one scene. */
export function graphEngine(): TGraphEngine {
	return new EngineGovernor();
}

/** The frame timing a scene measures with, built for one scene. `webgl` reads the scene's WebGL context lazily: its
 *  renderer exists only after the scene has loaded. */
export function graphFrameTime(webgl: () => TFenceGl | undefined, windowSamples: number, now?: () => number): TGraphFrameTime {
	return new FrameTime(webgl, windowSamples, now);
}

let contextDoc: TGraphContextDocument | undefined;

/** The graph's JSON-LD context document, pinned for the page: one read of the served context, shared by every view that
 *  scopes it to the type it shows. */
export function pageGraphContextDocument(): TGraphContextDocument {
	contextDoc ??= contextDocument();
	return contextDoc;
}

/** Test injection for the context document. */
export function installGraphContextDocument(doc?: TGraphContextDocument): void {
	contextDoc = doc;
}

let sizeObs: TSizeObserver | undefined;

/** The size observer, pinned for the page: it watches an element's box and reports its changes. */
export function pageGraphSizeObserver(): TSizeObserver {
	sizeObs ??= sizeObserver();
	return sizeObs;
}

/** Test injection for the size observer. */
export function installGraphSizeObserver(obs?: TSizeObserver): void {
	sizeObs = obs;
}
