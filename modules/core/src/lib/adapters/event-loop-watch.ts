/**
 * The event loop's delay over a process's run, from Node's `monitorEventLoopDelay` histograms alone: one over the whole process for its
 * summary, and one over each window between polls, whose largest delay past `LOOP_BLOCK_WARN_MS` is a stretch a synchronous path
 * held. A run states each such stretch as its window ends and the delay's summary once it ends, so a path that holds the loop is
 * found as it lands. The watch doesn't hold the process open.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { LOOP_BLOCK_WARN_MS, type TLoopWatch } from "../domains/event-loop.js";
/** The histograms' resolution: a stretch shorter than it isn't sampled. */
const RESOLUTION_MS = 10;
/** How often the watch reads its window, so stretches within one window state once, as the longest of them. */
const WINDOW_MS = 1_000;

const milliseconds = (ns: number): number => Math.round(ns / 1e4) / 100;

/** Watches the event loop, calling `onBlock` with how long the longest stretch of each window held it past `LOOP_BLOCK_WARN_MS`. */
export function watchEventLoop(onBlock: (heldMs: number) => void): TLoopWatch {
	const [run, window] = [monitorEventLoopDelay({ resolution: RESOLUTION_MS }), monitorEventLoopDelay({ resolution: RESOLUTION_MS })];
	run.enable();
	window.enable();
	let blocked = 0;
	const read = () => {
		const held = milliseconds(window.max);
		window.reset();
		if (held <= LOOP_BLOCK_WARN_MS) return;
		blocked += 1;
		onBlock(held);
	};
	const timer = setInterval(read, WINDOW_MS);
	timer.unref();
	return {
		summary: () => {
			read();
			return { maxMs: milliseconds(run.max), p99Ms: milliseconds(run.percentile(99)), blocked };
		},
		stop: () => {
			clearInterval(timer);
			run.disable();
			window.disable();
		},
	};
}
