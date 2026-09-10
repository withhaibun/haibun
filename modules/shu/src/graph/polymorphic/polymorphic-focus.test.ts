/**
 * The glow a freshly-streamed node wears: seeded at arrival, breathing on the shared rhythm, gone after its first
 * moments — unless the reader made the newcomer the active node, whose glow the selection owns for as long as it is
 * active. Driven through updateHighlight, the same per-frame pass the active node's breath rides.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PolymorphicFocus, type FocusDeps } from "../polymorphic/polymorphic-focus.js";
import { NEWCOMER_GLOW_MS } from "../polymorphic/polymorphic-highlight.js";
import type { FGNode } from "../polymorphic/polymorphic-graph-types.js";
import type { NodeVisual } from "./polymorphic-graph-types.js";

function stubVisual(): NodeVisual & { burns: number } {
	const v = {
		object: {} as never,
		pickTarget: {} as never,
		hasHighlight: false,
		burns: 0,
		opacity: 1,
		setHighlighted(on: boolean, glow?: unknown) {
			v.hasHighlight = on;
			if (on && glow) v.burns++;
		},
		faceCamera: () => undefined,
	};
	return v as NodeVisual & { burns: number };
}

function harness(selected: string | null = null) {
	const visual = stubVisual();
	const n: FGNode = { id: "n1", name: "n1", type: "Comment", __visual: visual };
	const deps = { selectedId: () => selected, nodeMap: () => new Map([[n.id, n]]), glowRamp: () => ["#ffffff", "#ffcc88"] } as unknown as FocusDeps;
	return { focus: new PolymorphicFocus(deps), n, visual };
}

describe("the glow a newcomer wears", () => {
	beforeEach(() => vi.useFakeTimers({ toFake: ["performance"] }));
	afterEach(() => vi.useRealTimers());

	it("burns from arrival, breathing on the shared rhythm, and asks the loop to keep drawing", () => {
		const { focus, n, visual } = harness();
		focus.seedNewcomerPop(n);
		expect(focus.updateHighlight(), "a breathing glow keeps the render loop awake").toBe(true);
		expect(visual.hasHighlight).toBe(true);
		expect(visual.burns).toBeGreaterThan(0);
	});

	it("ends with the welcome: after its first moments the glow is taken off in one drawn frame, then nothing keeps drawing for it", () => {
		const { focus, n, visual } = harness();
		focus.seedNewcomerPop(n);
		focus.updateHighlight();
		vi.advanceTimersByTime(NEWCOMER_GLOW_MS + 100);
		expect(focus.updateHighlight(), "the beat that ends the welcome draws the glow off").toBe(true);
		expect(visual.hasHighlight).toBe(false);
		expect(focus.updateHighlight(), "an expired welcome breathes nothing").toBe(false);
	});

	it("hands the glow to the selection where the reader chose the newcomer: expiry never strips the active node", () => {
		const { focus, n, visual } = harness("n1");
		focus.seedNewcomerPop(n);
		focus.updateHighlight();
		vi.advanceTimersByTime(NEWCOMER_GLOW_MS + 100);
		expect(focus.updateHighlight(), "the active node's breath goes on").toBe(true);
		expect(visual.hasHighlight).toBe(true);
	});
});

describe("the breath at rest", () => {
	beforeEach(() => vi.useFakeTimers({ toFake: ["performance"] }));
	afterEach(() => vi.useRealTimers());

	function active() {
		const h = harness("n1");
		h.visual.setHighlighted(true); // applyFocus gave the active node its glow
		h.visual.burns = 0;
		return h;
	}

	it("draws the active node's glow once, held at its fullest, and asks for no further frames", () => {
		const { focus, visual } = active();
		expect(focus.updateHighlight(false), "the beat that holds the glow draws it").toBe(true);
		expect(visual.burns).toBe(1);
		for (let beat = 0; beat < 20; beat++) {
			vi.advanceTimersByTime(100);
			expect(focus.updateHighlight(false), "a held glow costs no frame").toBe(false);
		}
		expect(visual.burns, "written once").toBe(1);
	});

	it("breathes again when the pulse returns, and holds again when it rests", () => {
		const { focus, visual } = active();
		focus.updateHighlight(false);
		expect(focus.updateHighlight(true), "breathing asks for a frame each beat").toBe(true);
		expect(focus.updateHighlight(true)).toBe(true);
		expect(visual.burns).toBe(3);
		expect(focus.updateHighlight(false), "resting again draws the held glow once").toBe(true);
		expect(focus.updateHighlight(false)).toBe(false);
	});

	it("at rest, a newcomer's glow is drawn when it arrives and drawn off when its welcome ends, and nothing between", () => {
		const { focus, n, visual } = harness();
		focus.seedNewcomerPop(n);
		expect(focus.updateHighlight(false), "the arrival draws the glow").toBe(true);
		expect(visual.burns).toBe(1);
		vi.advanceTimersByTime(NEWCOMER_GLOW_MS / 2);
		expect(focus.updateHighlight(false), "held").toBe(false);
		vi.advanceTimersByTime(NEWCOMER_GLOW_MS);
		expect(focus.updateHighlight(false), "the welcome's end draws the glow off").toBe(true);
		expect(visual.hasHighlight).toBe(false);
		expect(focus.updateHighlight(false)).toBe(false);
	});
});
