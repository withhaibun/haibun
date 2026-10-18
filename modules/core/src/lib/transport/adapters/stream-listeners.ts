/**
 * The listeners of an event stream: a stream read from a host and a stream replayed from a log both notify them, alike and
 * at the same moments. It holds the listeners, the events replayed to a listener that subscribes late, and whether the
 * stream is open, and records every dispatched event in a fixed-size replay buffer.
 */
import { failFastOrLog } from "../../domains/dev-mode.js";

/** How many events a replay buffer holds, where its stream doesn't state how many. */
export const REPLAY_BUFFER_LIMIT = 5000;

/** Fixed-size FIFO of recently dispatched events, replayed to a listener that subscribes after they arrived. */
class ReplayBuffer<E> {
	private readonly events: E[] = [];
	private recorded = 0;
	constructor(readonly limit: number) {
		if (limit <= 0) throw new Error(`ReplayBuffer: limit must be positive, got ${limit}`);
	}

	/** Append an event, dropping the oldest when the cap is exceeded. */
	record(event: E): void {
		this.events.push(event);
		this.recorded++;
		if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
	}

	/** Invoke `handler` for every buffered event that passes `filter`, or every one when a filter isn't given. */
	replay(handler: (event: E) => void, filter?: (event: E) => boolean): void {
		for (const event of this.events) {
			if (!filter || filter(event)) handler(event);
		}
	}

	/** Every event ever recorded, including ones the buffer has since dropped. */
	get totalRecorded(): number {
		return this.recorded;
	}
}

/**
 * Holds a stream's listeners, the events replayed to a listener that subscribes late, and whether the stream is open.
 * A stream read from a host and a stream replayed from a log both use it, so each notifies a listener of the same
 * changes at the same moments.
 */
export class StreamListeners<E> {
	private readonly listeners: { handler: (event: E) => void; filter?: (event: E) => boolean }[] = [];
	private readonly openListeners = new Set<() => void>();
	private readonly reconnectListeners = new Set<() => void>();
	private readonly disconnectListeners = new Set<() => void>();
	/** True from a break until the stream re-opens. The events sent during the break didn't reach a listener, so the
	 *  re-open calls the reconnect listeners. */
	private broken = false;
	private readonly buffer: ReplayBuffer<E>;

	/** `open` is true for a stream that is open from construction, such as a complete log. */
	constructor(
		private readonly name: string,
		replayLimit: number,
		private open: boolean,
	) {
		this.buffer = new ReplayBuffer<E>(replayLimit);
	}

	/** Register a listener, which receives every buffered event at once, then each live dispatch. Returns an unsubscribe. */
	subscribe(handler: (event: E) => void, filter?: (event: E) => boolean): () => void {
		const entry = { handler, filter };
		this.listeners.push(entry);
		this.buffer.replay(handler, filter);
		return () => {
			const idx = this.listeners.indexOf(entry);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	/** Registers `fn` to run when the stream opens. It runs at once for an open stream, and each time the stream opens
	 *  again. Returns an unsubscribe. */
	opened(fn: () => void): () => void {
		this.openListeners.add(fn);
		if (this.open) fn();
		return () => this.openListeners.delete(fn);
	}

	/** Registers `fn` to run when the stream re-opens after a break. The events sent during the break don't arrive in a dispatch,
	 *  so a consumer that follows actuality reads again when `fn` runs. It doesn't run on the first open, which doesn't
	 *  follow a break. Returns an unsubscribe. */
	reconnected(fn: () => void): () => void {
		this.reconnectListeners.add(fn);
		return () => this.reconnectListeners.delete(fn);
	}

	/** Registers `fn` to run when the stream breaks. It runs once per break, and at once for a stream already down, so a
	 *  consumer that subscribes after the break still receives the notification. Returns an unsubscribe. */
	disconnected(fn: () => void): () => void {
		this.disconnectListeners.add(fn);
		if (this.broken) fn();
		return () => this.disconnectListeners.delete(fn);
	}

	/** Marks the stream open and calls the open listeners. After a break, it also calls the reconnect listeners. */
	becameOpen(): void {
		this.open = true;
		this.notify(this.openListeners, "opening");
		if (!this.broken) return;
		this.broken = false;
		this.notify(this.reconnectListeners, "reconnection");
	}

	/** Marks the stream broken and calls the disconnect listeners once per break. A page that doesn't receive actuality's
	 *  events can't show its reading as current. The call states that fact, so a page doesn't infer it from an absence
	 *  of events. */
	broke(): void {
		const wasOpen = !this.broken;
		this.broken = true;
		this.open = false;
		if (wasOpen) this.notify(this.disconnectListeners, "disconnection");
	}

	/** Records an event and passes it to every listener whose filter accepts it. failFastOrLog handles a listener that
	 *  throws. In production it logs the error, and the other listeners still receive the event. A listener that throws on
	 *  a replayed event in `subscribe` throws to the caller of `subscribe`. */
	dispatch(event: E): void {
		this.buffer.record(event);
		for (const { handler, filter } of this.listeners) {
			if (filter && !filter(event)) continue;
			try {
				handler(event);
			} catch (err) {
				failFastOrLog(`${this.name}: listener threw during dispatch`, err);
			}
		}
	}

	/** Every event ever dispatched, including ones the replay buffer has since dropped. */
	totalRecorded(): number {
		return this.buffer.totalRecorded;
	}

	/** Removes every listener. A closed stream never opens again, so a message it receives after closing doesn't reach a listener. */
	clear(): void {
		this.listeners.length = 0;
		this.openListeners.clear();
		this.reconnectListeners.clear();
		this.disconnectListeners.clear();
	}

	/** Calls each listener of a change to the stream. failFastOrLog handles a listener that throws. In production it logs
	 *  the error, and the other listeners still run. */
	private notify(listeners: Set<() => void>, change: string): void {
		for (const fn of listeners) {
			try {
				fn();
			} catch (err) {
				failFastOrLog(`${this.name}: listener threw on ${change}`, err);
			}
		}
	}
}
