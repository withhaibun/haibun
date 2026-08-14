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

	it("ends with the welcome: after its first moments the glow is off and nothing keeps drawing for it", () => {
		const { focus, n, visual } = harness();
		focus.seedNewcomerPop(n);
		focus.updateHighlight();
		vi.advanceTimersByTime(NEWCOMER_GLOW_MS + 100);
		expect(focus.updateHighlight(), "an expired welcome breathes nothing").toBe(false);
		expect(visual.hasHighlight).toBe(false);
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
