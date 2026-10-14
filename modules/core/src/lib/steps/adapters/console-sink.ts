/**
 * Writes each narrated event to the console as one line of JSON.
 */
import type { TEventSink } from "../ports.js";

export const consoleSink: TEventSink = { write: (serialized) => console.log(serialized) };
