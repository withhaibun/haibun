/**
 * The event loop's watch states each stretch a synchronous path held the loop past the warning, and the delay's summary.
 */
import { describe, expect, it } from "vitest";
import { LOOP_BLOCK_WARN_MS } from "../domains/event-loop.js";
import { watchEventLoop } from "./event-loop-watch.js";

/** Holds the loop for `ms`, as a synchronous path does. */
const holdLoop = (ms: number): void => {
	const until = performance.now() + ms;
	while (performance.now() < until);
};

describe("the event loop's watch", () => {
	it("states a stretch held past the warning, and the delay's summary", async () => {
		const held: number[] = [];
		const watch = watchEventLoop((heldMs) => held.push(heldMs));
		try {
			await new Promise((ticked) => setTimeout(ticked, 50));
			holdLoop(LOOP_BLOCK_WARN_MS * 1.5);
			await new Promise((ticked) => setTimeout(ticked, 50));
			const summary = watch.summary();
			expect(held).toHaveLength(1);
			expect(held[0]).toBeGreaterThan(LOOP_BLOCK_WARN_MS);
			expect(summary.blocked).toBe(1);
			expect(summary.maxMs).toBeGreaterThan(LOOP_BLOCK_WARN_MS);
		} finally {
			watch.stop();
		}
	});
});
