// @vitest-environment jsdom
/**
 * The one drag: what it follows, what ends it, and what it ignores. A control that reads the pointer for as long as
 * it is held is easy to get subtly wrong, so the rules are here rather than in each control that drags.
 */
import { describe, it, expect } from "vitest";
import { startPointerDrag } from "./pointer-drag.js";

const press = (pointerId = 1) => new PointerEvent("pointerdown", { pointerId, clientY: 0, bubbles: true });
const move = (clientY: number, pointerId = 1) => document.dispatchEvent(new PointerEvent("pointermove", { pointerId, clientY, bubbles: true }));
const release = (pointerId = 1) => document.dispatchEvent(new PointerEvent("pointerup", { pointerId, bubbles: true }));

function started(pointerId = 1) {
	const moves: number[] = [];
	let ends = 0;
	const stop = startPointerDrag(press(pointerId), { onMove: (e) => moves.push(e.clientY), onEnd: () => ends++ });
	return { moves, stop, ended: () => ends };
}

describe("a drag follows the pointer that started it", () => {
	it("reports every move of that pointer, wherever on the page it goes", () => {
		const drag = started();
		move(10);
		move(25);
		expect(drag.moves).toEqual([10, 25]);
	});

	it("ignores a second pointer, so another finger cannot take the drag over", () => {
		const drag = started(1);
		move(30, 2);
		release(2);
		expect(drag.moves, "the other pointer's moves are not this drag's").toEqual([]);
		expect(drag.ended(), "and its release does not end this drag").toBe(0);
		move(40, 1);
		expect(drag.moves).toEqual([40]);
	});
});

describe("a drag ends once", () => {
	it("ends when its own pointer is released, and stops following it", () => {
		const drag = started();
		release();
		expect(drag.ended()).toBe(1);
		move(50);
		expect(drag.moves).toEqual([]);
	});

	it("ends when a cancel arrives, as a gesture taken over by the browser does", () => {
		const drag = started();
		document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
		expect(drag.ended()).toBe(1);
	});

	it("stops when its holder says so, without reporting an end it did not see", () => {
		const drag = started();
		drag.stop();
		move(60);
		release();
		expect(drag.moves, "a view that went away is no longer following").toEqual([]);
		expect(drag.ended(), "and nothing ended, since nothing was released while it held").toBe(0);
	});
});
