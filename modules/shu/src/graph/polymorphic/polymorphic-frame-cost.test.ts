// A frame's cost is measured with a fence after the draw and read when the fence signals, one frame in SAMPLE_EVERY, so
// the page learns what the renderer pays without stalling for it.
import { describe, expect, it } from "vitest";
import { FrameCost, SAMPLE_EVERY, type TFenceGl } from "./polymorphic-frame-cost.js";

/** A context whose fences signal after `pollsToSignal` status reads. */
function fakeGl(pollsToSignal: number) {
	const held = { fences: 0, deleted: 0, polls: new Map<object, number>(), gl: undefined as unknown as TFenceGl };
	held.gl = {
		SYNC_GPU_COMMANDS_COMPLETE: 1,
		SYNC_STATUS: 2,
		SIGNALED: 3,
		fenceSync: () => {
			held.fences++;
			const fence = {};
			held.polls.set(fence, 0);
			return fence;
		},
		getSyncParameter: (fence: unknown) => {
			const n = (held.polls.get(fence as object) ?? 0) + 1;
			held.polls.set(fence as object, n);
			return n >= pollsToSignal ? 3 : 0;
		},
		deleteSync: () => void held.deleted++,
		flush: () => undefined,
	};
	return held;
}

function clock() {
	const c = { t: 0, now: () => c.t };
	return c;
}

describe("measuring a drawn frame", () => {
	it("places one fence every SAMPLE_EVERY drawn frames and reports its cost once, when it signals", () => {
		const held = fakeGl(2);
		const c = clock();
		const cost = new FrameCost(() => held.gl, c.now);
		for (let i = 0; i < SAMPLE_EVERY - 1; i++) cost.drew();
		expect(held.fences, "no fence before the sampled frame").toBe(0);
		cost.drew();
		expect(held.fences).toBe(1);
		c.t = 5;
		expect(cost.poll(), "not signalled yet").toBeUndefined();
		c.t = 17;
		expect(cost.poll(), "the cost from the fence to its signal").toBe(17);
		expect(cost.poll(), "reported once").toBeUndefined();
		expect(held.deleted).toBe(1);
	});

	it("holds one measurement at a time: sampled frames drawn while a fence is pending are not measured", () => {
		const held = fakeGl(100);
		const cost = new FrameCost(() => held.gl);
		for (let i = 0; i < SAMPLE_EVERY * 3; i++) cost.drew();
		expect(held.fences).toBe(1);
	});

	it("measures nothing on a context without fences, and nothing before the renderer exists", () => {
		const cost = new FrameCost(() => ({}) as unknown as TFenceGl);
		for (let i = 0; i < SAMPLE_EVERY; i++) cost.drew();
		expect(cost.poll()).toBeUndefined();
		let gl: TFenceGl | undefined;
		const later = new FrameCost(() => gl);
		for (let i = 0; i < SAMPLE_EVERY; i++) later.drew();
		expect(later.poll(), "no renderer yet").toBeUndefined();
		const held = fakeGl(1);
		gl = held.gl;
		for (let i = 0; i < SAMPLE_EVERY; i++) later.drew();
		expect(held.fences, "the renderer arrived: measured from then on").toBe(1);
	});

	it("releases a pending fence when the scene ends", () => {
		const held = fakeGl(100);
		const cost = new FrameCost(() => held.gl);
		for (let i = 0; i < SAMPLE_EVERY; i++) cost.drew();
		cost.end();
		expect(held.deleted).toBe(1);
		expect(cost.poll()).toBeUndefined();
	});
});
