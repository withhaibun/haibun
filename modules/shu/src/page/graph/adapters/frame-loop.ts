/**
 * Drawing on demand: the loop that draws the scene runs while something is moving and stops when motion ends.
 *
 * The renderer owns the animation loop that draws an A-Frame scene, and the scene's `pause()` stops its components
 * without stopping that loop, so a paused scene still draws every frame. This gate stops the loop on the frame motion
 * ends and starts it on the frame motion begins. The scene reports each frame whether anything is moving, and a frame
 * whose report matches the last one doesn't change the loop.
 */
import type { TGraphFrameLoop } from "../ports.js";

/** What can be started and stopped: the renderer's own animation loop, and with it the scene's components. */
type TDrawingLoop = { start(): void; stop(): void };

/** The gate that runs the media's render loop while something moves. The scene reports each frame whether anything
 *  moves, and a frame that reports what the last one did doesn't change the loop. The scene's end stops the loop for good. */
export class Drawing implements TGraphFrameLoop {
	#drawing = true;
	#ended = false;

	constructor(private readonly loop: TDrawingLoop) {}

	/** Whether the scene is drawing now. */
	get drawing(): boolean {
		return this.#drawing;
	}

	/** Takes each frame's report of whether anything is moving. The loop starts on the frame motion begins and stops on
	 *  the frame motion ends. A frame that reports what the last one did doesn't change the loop. */
	moving(isMoving: boolean): void {
		if (this.#ended || isMoving === this.#drawing) return;
		this.#drawing = isMoving;
		if (isMoving) this.loop.start();
		else this.loop.stop();
	}

	/** The scene is going away: stop drawing whatever the last frame rendered. A frame in progress that reports motion after
	 *  the end doesn't start the loop again. */
	end(): void {
		this.#ended = true;
		if (!this.#drawing) return;
		this.#drawing = false;
		this.loop.stop();
	}
}

/** The slice of an A-Frame scene the loop drives. */
export type TAframeScene = {
	pause?(): void;
	play?(): void;
	render?: (time: number, frame: unknown) => void;
	renderer?: { setAnimationLoop(loop: ((time: number, frame: unknown) => void) | null): void };
	renderStarted?: boolean;
	addEventListener?(type: string, listener: () => void, options?: { once: boolean }): void;
};

/** The loop that draws an A-Frame scene. Starting plays the components and hands the scene's own bound render back to
 *  the renderer, followed by `afterDraw` when given, so a frame's time can be measured right after it. Stopping pauses
 *  the components and takes the render away, so a frame isn't drawn until something moves. The last frame drawn stays
 *  on the canvas.
 *
 * A-Frame installs its own loop when the scene starts rendering. With something to do after each draw, this loop
 * replaces that one as soon as it has been installed, so every drawn frame is followed, the first ones included. A loop
 * stopped before the scene starts rendering takes A-Frame's loop away as A-Frame installs it, so a scene that ended before
 * its first frame doesn't draw one. */
export function aframeLoop(scene: TAframeScene, afterDraw?: () => void): TDrawingLoop {
	let running = true;
	const halt = () => scene.renderer?.setAnimationLoop(null);
	const install = () => {
		const render = scene.render;
		if (!render) return;
		scene.renderer?.setAnimationLoop(
			afterDraw
				? (time, frame) => {
						render(time, frame);
						afterDraw();
					}
				: render,
		);
	};
	const renderStarted = () => {
		if (!running) halt();
		else if (afterDraw) install();
	};
	if (!scene.renderStarted) scene.addEventListener?.("renderstart", renderStarted, { once: true });
	else if (afterDraw) install();
	return {
		start: () => {
			running = true;
			scene.play?.();
			install();
		},
		stop: () => {
			running = false;
			scene.pause?.();
			halt();
		},
	};
}
