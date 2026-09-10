// A scene draws while something is moving and stops when nothing is. Pausing A-Frame's components never stopped the
// renderer's own loop, so an idle page drew the same picture sixty times a second for as long as it stayed open. These
// cases hold the loop to the motion.
import { describe, it, expect } from "vitest";
import { Drawing, aframeLoop } from "./polymorphic-drawing.js";

function counted(): { loop: { start(): void; stop(): void }; starts: number; stops: number } {
	const held = { starts: 0, stops: 0, loop: { start: () => undefined, stop: () => undefined } };
	held.loop = { start: () => void held.starts++, stop: () => void held.stops++ };
	return held;
}

describe("drawing on demand", () => {
	it("stops the loop on the frame motion ends, and does nothing on the frames after", () => {
		const held = counted();
		const drawing = new Drawing(held.loop);
		drawing.moving(false);
		drawing.moving(false);
		drawing.moving(false);
		expect(held.stops, "stopped once, when motion ended").toBe(1);
		expect(drawing.drawing).toBe(false);
	});

	it("starts the loop on the frame motion begins again, once", () => {
		const held = counted();
		const drawing = new Drawing(held.loop);
		drawing.moving(false);
		drawing.moving(true);
		drawing.moving(true);
		expect(held.starts, "started once, when motion began").toBe(1);
		expect(drawing.drawing).toBe(true);
	});

	it("is drawing when made: a scene draws its first frame before it can be still", () => {
		const held = counted();
		const drawing = new Drawing(held.loop);
		drawing.moving(true);
		expect(held.starts, "already drawing: nothing to start").toBe(0);
	});

	it("stops when the scene ends, and not again if it was already still", () => {
		const held = counted();
		const drawing = new Drawing(held.loop);
		drawing.end();
		drawing.end();
		expect(held.stops).toBe(1);
		const still = counted();
		const stilled = new Drawing(still.loop);
		stilled.moving(false);
		stilled.end();
		expect(still.stops, "stopped by motion ending; the end has nothing left to stop").toBe(1);
	});
});

describe("an A-Frame scene's loop", () => {
	function scene() {
		const calls: string[] = [];
		const render = (): void => undefined;
		return {
			calls,
			scene: {
				play: () => void calls.push("play"),
				pause: () => void calls.push("pause"),
				render,
				renderer: { setAnimationLoop: (loop: unknown) => void calls.push(loop === null ? "loop:none" : loop === render ? "loop:render" : "loop:other") },
			},
		};
	}

	it("stopping pauses the components and takes the render away from the renderer, so nothing is drawn", () => {
		const s = scene();
		aframeLoop(s.scene).stop();
		expect(s.calls).toEqual(["pause", "loop:none"]);
	});

	it("starting plays the components and hands the scene's own render back", () => {
		const s = scene();
		aframeLoop(s.scene).start();
		expect(s.calls).toEqual(["play", "loop:render"]);
	});

	it("pauses and plays a scene that has no renderer yet", () => {
		const calls: string[] = [];
		const loop = aframeLoop({ play: () => void calls.push("play"), pause: () => void calls.push("pause") });
		loop.stop();
		loop.start();
		expect(calls).toEqual(["pause", "play"]);
	});
});
