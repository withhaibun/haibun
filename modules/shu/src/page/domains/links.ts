/**
 * A link a page follows: a step's method, its parameters, a summary, and whether the call reads actuality or acts in it.
 * Actuality doesn't record a read, and records what an act does. Actuality holds a link's `asks` to the step's own
 * declaration, and refuses a read of a step that doesn't declare itself one. `asks` is required, so a link is made only
 * through `reads` or `acts`, and a page can't read through a step whose call actuality records.
 */
import type { TStreamChunk } from "@haibun/core/lib/step-stream-context.js";

/** Whether a call reads actuality or acts in it. */
type TAsks = "read" | "act";

/** A link to a step: `method` is the full `Stepper-methodName` actuality dispatches, and actuality refuses a method it
 *  doesn't declare. */
export type TLink = { method: string; params?: Record<string, unknown>; summary?: string; asks: TAsks };

/** Returns a link that reads actuality. Actuality returns the step's products and doesn't record the read. */
export const reads = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "read" });

/** Returns a link that acts in actuality. Actuality records what the step does. */
export const acts = (method: string, params?: Record<string, unknown>, summary?: string): TLink => ({ method, params, summary, asks: "act" });

/** A record as a call returns it: its fields and its hypermedia markers, each optional. A record without `_links` is a
 *  representation too. */
export type TRepresentation = { _type?: string; _summary?: string; _description?: string; _links?: Record<string, TLink>; _seqPath?: number[]; [key: string]: unknown };

/** One chunk of a streamed call, as core's emitter writes it. */
export type { TStreamChunk };
