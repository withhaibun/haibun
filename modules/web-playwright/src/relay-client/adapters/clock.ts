/** The system clock of the extension's side of the relay: a task runs once a span passes, through a timer. */
import type { TClock } from "../ports.js";

export const timerClock: TClock = { after: (ms, task) => void setTimeout(task, ms) };
