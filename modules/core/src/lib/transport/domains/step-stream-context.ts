/**
 * Per-request streaming side-channel for step dispatch.
 *
 * Some step actions (a consumer's chat turn among them) emit progress
 * chunks during `dispatchStep`. The step still runs through `dispatchStep`,
 * so its lifecycle events (start, end, error) carry the caller's seqPath.
 *
 * The streaming transport (NDJSON over /rpc/:method when `stream: true`)
 * opens the response and builds an emit callback that writes NDJSON chunks.
 * It runs the dispatcher inside `streamContext.run(streamOver(emit, …), …)`.
 * Step actions read `streamContext.getStore()?.emit` to send chunks. An
 * action buffers the text and returns it in full as products where
 * `streamContext.getStore()` returns undefined.
 *
 * AsyncLocalStorage isolates the context per async chain, so a request
 * doesn't receive the emit callback of a concurrent request.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TIndividualAddress } from "../../domains/typed-links.js";
import type { TCalled } from "../../domains/called.js";

/** A call that a step made for its caller and that the authority the step holds didn't allow. It holds the called step and the
 *  action that step requires. The caller may hold that action and allow the call. */
export type TRefusedCall = { step: string; action: string };

/** One streamed step chunk. It holds any of the step's progress status, a line of what the step sends on its caller's
 *  behalf, a call the step made, a text fragment, an individual the step recorded, a call the step was refused, a message
 *  in the call's protocol for the caller to act on, and a terminal error. The transport serializes this shape to NDJSON
 *  or SSE, and the shu client reads it. */
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
	/** End the call from the server's side. `end` emits the reason to the caller as an error in the stream's last chunk,
	 *  and `signal` aborts. */
	end: (reason: string) => void;
};

export const streamContext = new AsyncLocalStorage<TStreamCtx>();

/** Returns a stream context over `emit` with the signal of `stopped`, which the caller aborts once its caller leaves. `end`
 *  emits the reason as an error in the last chunk and aborts `stopped`. A second `end` doesn't emit. */
export function streamOver(emit: (chunk: TStreamChunk) => void, stopped: AbortController): TStreamCtx {
	const end = (reason: string) => {
		if (stopped.signal.aborted) return;
		emit({ error: reason });
		stopped.abort(reason);
	};
	return { emit, signal: stopped.signal, end };
}
