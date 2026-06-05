/**
 * Per-request streaming side-channel for step-dispatch.
 *
 * Some step actions (notably LlmStepper.chatWithContext) want to emit
 * progress chunks while still going through `dispatchStep` — so that the
 * step's lifecycle events (start, end, error) stay bound to the caller's
 * seqPath, not delivered out-of-band.
 *
 * The streaming transport (NDJSON over /rpc/:method when `stream: true`)
 * opens the response, builds an emit callback that writes NDJSON chunks,
 * and runs the dispatcher inside `streamContext.run({emit, signal}, …)`.
 * Step actions read `streamContext.getStore()?.emit` to push chunks; if
 * the store is absent the action falls back to buffering and returning
 * the full text as products.
 *
 * AsyncLocalStorage isolates the context per async chain, so concurrent
 * requests never see each other's emit callback. This is the same
 * pattern haibun uses in node-http-events for per-step HTTP tracing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** One streamed step chunk: a status update, a text fragment, and/or a terminal error. The same shape is serialized to NDJSON/SSE by the transport and consumed by the shu client. */
export type TStreamChunk = { status?: string; text?: string; error?: string };

export type TStreamCtx = {
	emit: (chunk: TStreamChunk) => void;
	signal: AbortSignal;
};

export const streamContext = new AsyncLocalStorage<TStreamCtx>();
