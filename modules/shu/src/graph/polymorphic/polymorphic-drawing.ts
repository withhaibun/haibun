/**
 * Drawing on demand: the loop that draws the scene runs while something is moving and stops when nothing is.
 *
 * The renderer owns the animation loop that draws an A-Frame scene. Loading the scene starts that loop. Pausing the
 * scene stops its components and leaves the loop drawing every frame. An idle page therefore drew the same picture
 * sixty times a second for as long as it stayed open, and a headless browser read each of those frames back through a
 * software rasterizer, so a finished run's GPU process held eight cores. Stopping the components never stopped the
 * drawing. This stops the drawing.
 *
 * The scene reports each frame whether anything is moving. The loop starts or stops on the frame that report changes
 * and nothing happens on any other frame.
 */

/** What can be started and stopped: the renderer's own animation loop, and with it the scene's components. */
export type TDrawingLoop = { start(): void; stop(): void };

export class Drawing {
	#drawing = true;

	constructor(private readonly loop: TDrawingLoop) {}

	/** Whether the scene is drawing now. */
	get drawing(): boolean {
		return this.#drawing;
	}

	/** Takes each frame's report of whether anything is moving. The loop starts on the frame motion begins and stops on
	 *  the frame motion ends. A frame that reports what the last one did changes nothing. */
	moving(isMoving: boolean): void {
		if (isMoving === this.#drawing) return;
		this.#drawing = isMoving;
		if (isMoving) this.loop.start();
		else this.loop.stop();
	}

	/** The scene is going away: stop drawing whatever the last frame said. */
	end(): void {
		if (!this.#drawing) return;
		this.#drawing = false;
		this.loop.stop();
	}
}

/**
 * The loop an A-Frame scene draws with. Starting plays the components and hands the scene's own bound render back to
 * the renderer, followed by `afterDraw` when given, so a frame's cost can be measured right after it. Stopping pauses
 * the components and takes the render away, so no frame is drawn until something moves. The last frame drawn stays on
 * the canvas.
 *
 * A-Frame installs its own loop when the scene starts rendering. With something to do after each draw, this loop
 * replaces that one as soon as it has been installed, so every drawn frame is followed, the first ones included.
 */
export type TAframeScene = {
	pause?(): void;
	play?(): void;
	render?: (time: number, frame: unknown) => void;
	renderer?: { setAnimationLoop(loop: ((time: number, frame: unknown) => void) | null): void };
	renderStarted?: boolean;
	addEventListener?(type: string, listener: () => void, options?: { once: boolean }): void;
};

export function aframeLoop(scene: TAframeScene, afterDraw?: () => void): TDrawingLoop {
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
	if (afterDraw) {
		if (scene.renderStarted) install();
		else scene.addEventListener?.("renderstart", install, { once: true });
	}
	return {
		start: () => {
			scene.play?.();
			install();
		},
		stop: () => {
			scene.pause?.();
			scene.renderer?.setAnimationLoop(null);
		},
	};
}
