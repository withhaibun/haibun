/** The page's event stream, as a view and the page's reads subscribe to it: in batches, one per frame. */
import { pageClock, pageEventStream } from "../root.js";
import { batchedEvents, type TBatchedEvents } from "../pipelines/batched-events.js";

export { hasEventStream } from "../root.js";

/** Subscribes to the page's events in batches, one per frame (`batchedEvents`). Returns the call that stops it. */
export const subscribeBatchedEvents = (opts: TBatchedEvents): (() => void) => batchedEvents(pageEventStream(), pageClock(), opts);
