/**
 * Per-request streaming side-channel for step-dispatch.
 *
 * Some step actions (a consumer's chat turn among them) want to emit
 * progress chunks while still going through `dispatchStep`, so that the
 * step's lifecycle events (start, end, error) stay bound to the caller's
 * seqPath, not delivered out-of-band.
 *
 * The streaming transport (NDJSON over /rpc/:method when `stream: true`)
 * opens the response, builds an emit callback that writes NDJSON chunks,
 * and runs the dispatcher inside `streamContext.run({emit, signal, end}, …)`.
 * Step actions read `streamContext.getStore()?.emit` to push chunks; if
 * the store is absent the action falls back to buffering and returning
 * the full text as products.
 *
 * AsyncLocalStorage isolates the context per async chain, so concurrent
 * requests never see each other's emit callback.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TIndividualAddress } from "./typed-links.js";

/** A call a step made for its caller that what the step holds did not allow: the step it named, and the action that step
 *  requires, which the caller may hold and allow. */
export type TRefusedCall = { step: string; action: string };

/** A call a step made for its caller: the step it named, whether that step answered, and the record of the call. */
export type TCalled = { name: string; ok: boolean; record: TIndividualAddress };

/** One streamed step chunk: how the step is progressing, a line of what it sends on its caller's behalf, a call it made, a
 *  text fragment, an individual the step just recorded, a call it was refused, a message in the protocol the call carries
 *  for its caller to act on, and/or a terminal error. The same shape is serialized to NDJSON/SSE by the transport and
 *  consumed by the shu client. */
export type TStreamChunk = {
	status?: string;
	context?: string;
	called?: TCalled;
	text?: string;
	recorded?: TIndividualAddress;
	refused?: TRefusedCall;
	message?: unknown;
	error?: string;
};

type TStreamCtx = {
	emit: (chunk: TStreamChunk) => void;
	signal: AbortSignal;
	/** End the call from the server's side, telling its caller why: the stream's last chunk is the reason, as an error,
	 *  and `signal` aborts. */
	end: (reason: string) => void;
};

export const streamContext = new AsyncLocalStorage<TStreamCtx>();

/** A stream over `emit`, stopped through `stopped`: ending it states the reason as its last chunk, an error, and stops it. */
export function streamOver(emit: (chunk: TStreamChunk) => void, stopped = new AbortController()): TStreamCtx {
	const end = (reason: string) => {
		if (stopped.signal.aborted) return;
		emit({ error: reason });
		stopped.abort(reason);
	};
	return { emit, signal: stopped.signal, end };
}
