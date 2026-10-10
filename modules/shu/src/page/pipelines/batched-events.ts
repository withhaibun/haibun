/**
 * Subscribes to the page's events, and passes the events that arrive between two frames to one call, on the frame. A view
 * renders once per frame however many events arrive. `onReconnect` runs when the stream opens again after a break, and
 * the caller reads again through the same path as for an arrival. `onDisconnect` runs when the stream breaks.
 */
import type { TClock, TEvent, TEventFilter, TEventStream } from "../ports.js";

export type TBatchedEvents = { onBatch: (events: TEvent[]) => void; filter?: TEventFilter; onReconnect?: () => void; onDisconnect?: () => void };

/** Returns the call that stops the subscription and drops the events it holds. */
export function batchedEvents(stream: TEventStream, clock: TClock, { onBatch, filter, onReconnect, onDisconnect }: TBatchedEvents): () => void {
	let pending: TEvent[] = [];
	let cancelFrame: (() => void) | undefined;
	let active = true;
	const drain = (): void => {
		cancelFrame = undefined;
		if (!active || pending.length === 0) return;
		const batch = pending;
		pending = [];
		onBatch(batch);
	};
	const stopReconnects = onReconnect ? stream.reconnected(() => active && onReconnect()) : undefined;
	const stopDisconnects = onDisconnect ? stream.disconnected(() => active && onDisconnect()) : undefined;
	const stopEvents = stream.subscribe((event) => {
		if (!active) return;
		pending.push(event);
		if (!cancelFrame) cancelFrame = clock.frame(drain);
	}, filter);
	return () => {
		active = false;
		pending = [];
		cancelFrame?.();
		stopReconnects?.();
		stopDisconnects?.();
		stopEvents();
	};
}
