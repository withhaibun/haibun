/**
 * The clock of this process.
 */
import type { TClock } from "../ports.js";

/** Reads this process's clock. */
export const systemClock: TClock = { now: () => Date.now() };
