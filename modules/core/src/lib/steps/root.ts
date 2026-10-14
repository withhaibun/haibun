/**
 * The composition root of the step infrastructure: the sink through which the events hub writes each narrated event.
 */
import type { TEventSink } from "./ports.js";
import { consoleSink } from "./adapters/console-sink.js";

/** The sink of actuality's events hub: the console. */
export const eventSink = (): TEventSink => consoleSink;
