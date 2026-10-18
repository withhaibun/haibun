/**
 * What a scene element runs on, built for one scene: the engine that paces its graph, the frame scheduler, the profiler,
 * the layout tween and the data pipeline, the scene's clock, and the page's frame loop and frame timing. The scene is a view,
 * which reads machines, pipelines and ports through this controller alone (CA3D3, CA3D5).
 */
import { reportFailure } from "../../controllers/client-log-controller.js";
import { pageClock } from "../../root.js";
import { graphEngine, graphFrameLoop, graphFrameTime } from "../root.js";
import { FrameScheduler } from "../machines/frame-scheduler.js";
import { PolymorphicProfiler } from "../machines/profiler.js";
import { LayoutTween } from "../machines/layout-tween.js";
import { DataPipeline, type DataPipelineDeps } from "../pipelines/data-pipeline.js";
import { easeInOutCubic } from "../derivations/grouping.js";
import type { TClock } from "../../ports.js";
import type { TGraphEngine, TGraphFrameLoop, TGraphFrameTime } from "../ports.js";
import type { TAframeScene } from "../adapters/frame-loop.js";
import type { TFenceGl } from "../adapters/frame-time.js";

/** How long a layout change's tween glides each node from where it was to where it lands. */
const TWEEN_MS = 700;

export class SceneController {
	readonly engine: TGraphEngine = graphEngine();
	readonly frame = new FrameScheduler((name, err) => reportFailure("polymorphic-frame", `the frame job "${name}" failed and is disabled`, err));
	readonly profiler = new PolymorphicProfiler();
	readonly tween = new LayoutTween(TWEEN_MS, easeInOutCubic);

	/** The scene's connections, counted: a request calls its callback only in the connection that made it. */
	#connection = 0;
	#ended = false;

	/** The scene's clock: the page's clock, whose timers and frames call back only in the connection that requested them,
	 *  before the scene ends. A frame in progress can request the next frame as the scene ends, and that frame doesn't call
	 *  its callback. */
	readonly clock: TClock = {
		now: () => pageClock().now(),
		elapsed: () => pageClock().elapsed(),
		after: (ms, fn) => pageClock().after(ms, this.#inConnection(fn)),
		frame: (fn) => pageClock().frame(this.#inConnection(fn)),
	};

	/** The scene connected: an ended scene counts a new connection, and a request of an earlier one doesn't call back. */
	begin(): void {
		if (!this.#ended) return;
		this.#ended = false;
		this.#connection++;
	}

	/** The scene ended: each timer and frame it requested, before or after, doesn't call back. */
	end(): void {
		this.#ended = true;
	}

	/** Returns `fn` as a call that calls it in the current connection, before the scene ends. */
	#inConnection(fn: () => void): () => void {
		const connection = this.#connection;
		return () => {
			if (!this.#ended && connection === this.#connection) fn();
		};
	}

	/** The scene's data pipeline, which turns the visible model into the nodes and links the scene draws. */
	pipeline(deps: DataPipelineDeps): DataPipeline {
		return new DataPipeline(deps);
	}

	/** The gate that runs the scene's render loop while something moves; `afterDraw` follows each drawn frame. */
	frameLoop(scene: TAframeScene, afterDraw: () => void): TGraphFrameLoop {
		return graphFrameLoop(scene, afterDraw);
	}

	/** What a drawn frame takes the renderer, read from the scene's WebGL context once its renderer exists. */
	frameTime(webgl: () => TFenceGl | undefined, windowSamples: number): TGraphFrameTime {
		return graphFrameTime(webgl, windowSamples, () => pageClock().elapsed());
	}
}
