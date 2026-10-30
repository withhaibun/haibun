/**
 * The event loop's delay over a process's run: Node's `monitorEventLoopDelay` histogram, and a timer that finds each stretch the
 * loop was held past `LOOP_BLOCK_WARN_MS`, which a synchronous path held. A run states each such stretch as it ends and the
 * delay's summary once it ends, so a path that holds the loop is found as it lands. The watch doesn't hold the process open.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { LOOP_BLOCK_WARN_MS, type TLoopWatch } from "../domains/event-loop.js";
/** How often the timer reads the loop, which a stretch shorter than it doesn't delay. */
const TICK_MS = 10;

const milliseconds = (ns: number): number => Math.round(ns / 1e4) / 100;

/** Watches the event loop, calling `onBlock` with how long each stretch held it past `LOOP_BLOCK_WARN_MS`. */
export function watchEventLoop(onBlock: (heldMs: number) => void): TLoopWatch {
	const histogram = monitorEventLoopDelay({ resolution: TICK_MS });
	histogram.enable();
	let blocked = 0;
	let last = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		const held = Math.round(now - last - TICK_MS);
		last = now;
		if (held <= LOOP_BLOCK_WARN_MS) return;
		blocked += 1;
		onBlock(held);
	}, TICK_MS);
	timer.unref();
	return {
		summary: () => ({ maxMs: milliseconds(histogram.max), p99Ms: milliseconds(histogram.percentile(99)), blocked }),
		stop: () => {
			clearInterval(timer);
			histogram.disable();
		},
	};
}
