/** The system clock: a task runs in a later turn of the event loop, through a timer. */
import type { TClock } from "../ports.js";

export const systemClock: TClock = { later: (task) => void setTimeout(task, 0) };
