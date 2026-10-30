/**
 * The event loop's delay as a process states it: the stretch past which it warns that a synchronous path held the loop, and the
 * delay's summary since its watch began.
 */

/** How long the loop may be held before the process warns. */
export const LOOP_BLOCK_WARN_MS = 500;

/** The delay since the watch began: its longest and its 99th percentile, in milliseconds, and how many stretches held the loop past the warning. */
export type TLoopSummary = { maxMs: number; p99Ms: number; blocked: number };
/** A watch of the event loop: its summary so far, and its end. */
export type TLoopWatch = { summary(): TLoopSummary; stop(): void };
