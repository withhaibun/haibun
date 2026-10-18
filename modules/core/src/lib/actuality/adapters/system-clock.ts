/**
 * The clock of this process.
 */
import type { TClock } from "../ports.js";

/** Reads this process's clock, and waits through its timers. */
export const systemClock: TClock = { now: () => Date.now(), wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
