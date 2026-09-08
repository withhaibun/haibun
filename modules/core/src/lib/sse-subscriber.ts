/**
 * sse-subscriber — EventSource client shared by every consumer of a
 * haibun host's /sse event stream.
 *
 * Browser SPAs connect to their own origin's /sse; Node-side peers
 * connect to another host's /sse. Both need the same primitives: open,
 * dispatch parsed events to listeners, reconnect on error with backoff,
 * filter subscriptions, close cleanly. This class centralises that.
 *
 * Transport-agnostic within the EventSource contract: the caller
 * supplies the URL; whether it resolves to the same origin or a
 * remote host is the caller's concern.
 *
 * The SSE message format this subscriber decodes is the one
 * web-server-hono's SSETransport emits: each `message` event's
 * `data` field is a JSON envelope with `{ type, event, ... }` or a
 * plain event payload. Payloads that don't parse as JSON are passed
 * through verbatim so callers can handle wire-format variants.
 *
 * --- Replay buffer (`ReplayBuffer`) ---
 * Every dispatched event is also recorded in a `ReplayBuffer` (a fixed-
 * size FIFO) so that a `subscribe()` call AFTER the connection opened
 * still sees what this page received before it subscribed.
 *
 * --- Reconnection ---
 * The server replays nothing on connect: what happened is in the graph.
 * A stream that breaks and re-opens announces the re-open through
 * `reconnected()`, which is how a consumer following the run knows to
 * read again for what happened while nothing was heard.
 *
 * The buffer is an explicit, exported class (not a hidden field) so
 * consumers can inspect it (`getReplayBuffer()`) and the contract is
 * legible from one read of the file.
 */

import type { THaibunEvent } from "../schema/protocol.js";
import { failFastOrLog } from "./dev-mode.js";

type EventHandler = (event: THaibunEvent) => void;
type EventFilter = (event: THaibunEvent) => boolean;

// biome-ignore lint/suspicious/noExplicitAny: EventSource is a DOM/Node global that may be polyfilled.
type EventSourceCtor = new (url: string) => any;

/** Default cap for the per-subscriber replay buffer. Overrideable via SseSubscriberConfig. */
export const REPLAY_BUFFER_LIMIT_DEFAULT = 5000;

/**
 * Fixed-size FIFO of recently dispatched events. A `subscribe()` call
 * synchronously walks the buffer and re-invokes the new handler with
 * each event, so consumers that mount AFTER the SSE connection opened
 * still see the run history the server replayed on connect.
 *
 * Public methods are intentionally narrow: callers `record` an event,
 * `replay` to a handler, or read `size` / `limit`. The buffer never
 * filters — that's a per-subscriber decision in `replay()`.
 */
export class ReplayBuffer {
	private readonly events: THaibunEvent[] = [];
	private _totalRecorded = 0;
	constructor(readonly limit: number) {
		if (limit <= 0) throw new Error(`ReplayBuffer: limit must be positive, got ${limit}`);
	}

	/** Append an event, dropping the oldest when the cap is exceeded. */
	record(event: THaibunEvent): void {
		this.events.push(event);
		this._totalRecorded++;
		if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
	}

	/** Synchronously invoke `handler` for every buffered event that passes `filter` (or all when filter is undefined). */
	replay(handler: EventHandler, filter?: EventFilter): void {
		for (const event of this.events) {
			if (!filter || filter(event)) handler(event);
		}
	}

	/** Current number of buffered events. */
	get size(): number {
		return this.events.length;
	}

	/**
	 * Total events ever recorded, including ones the buffer has since dropped.
	 * Exceeds `size` only after the buffer has wrapped — that difference is what
	 * tells a UI it's looking at a truncated tail.
	 */
	get totalRecorded(): number {
		return this._totalRecorded;
	}

	/** Snapshot of the buffer for inspection. Returns a copy to keep the internal array opaque. */
	snapshot(): THaibunEvent[] {
		return this.events.slice();
	}

	/** Drop every buffered event. Used by callers that want a fresh start. */
	clear(): void {
		this.events.length = 0;
	}
}

export type SseSubscriberConfig = {
	/** Full URL of the SSE endpoint — absolute for remote hosts, relative for same-origin. */
	url: string;
	/** Reconnect delay on error, in ms. Default 2000. */
	reconnectDelayMs?: number;
	/**
	 * Override the EventSource constructor. Defaults to globalThis.EventSource.
	 * Tests inject a mock; Node consumers can pass undici's or a polyfill.
	 */
	EventSourceCtor?: EventSourceCtor;
	/** Short tag included in log lines to distinguish multiple subscribers. */
	clientId?: string;
	/** Cap for the per-subscriber replay buffer. Defaults to REPLAY_BUFFER_LIMIT_DEFAULT. */
	replayBufferLimit?: number;
};

export class SseSubscriber {
	private readonly url: string;
	private readonly reconnectDelayMs: number;
	private readonly EventSourceCtor: EventSourceCtor;
	private readonly clientId: string;
	// biome-ignore lint/suspicious/noExplicitAny: dynamic
	private source: any | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly listeners: { handler: EventHandler; filter?: EventFilter }[] = [];
	private closed = false;
	/** The stream has dropped and not yet re-opened. What happened meanwhile reached no listener, so the re-open is
	 *  announced to whoever follows the run: that is when they have something to read again for. */
	private broken = false;
	private readonly reconnectListeners = new Set<() => void>();
	private readonly disconnectListeners = new Set<() => void>();
	private lastEventAt: number | null = null;
	private connectedAt: number | null = null;
	/** Replay buffer — see file header and the `ReplayBuffer` class. */
	private readonly replayBuffer: ReplayBuffer;

	constructor(config: SseSubscriberConfig) {
		this.url = config.url;
		this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
		const ctor = config.EventSourceCtor ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource;
		if (!ctor) {
			throw new Error("SseSubscriber: no EventSource constructor available (set SseSubscriberConfig.EventSourceCtor)");
		}
		this.EventSourceCtor = ctor;
		this.clientId = config.clientId ?? `sse-${Math.random().toString(36).slice(2, 8)}`;
		this.replayBuffer = new ReplayBuffer(config.replayBufferLimit ?? REPLAY_BUFFER_LIMIT_DEFAULT);
	}

	/** Open the stream. Subsequent subscribe/close calls operate on this connection. Idempotent. */
	connect(): void {
		if (this.closed) return;
		if (this.source) return;
		if (this.connectedAt === null) this.connectedAt = Date.now();
		this.source = new this.EventSourceCtor(this.url);
		this.source.onopen = () => {
			if (!this.broken) return;
			this.broken = false;
			for (const fn of this.reconnectListeners) {
				try {
					fn();
				} catch (err) {
					failFastOrLog(`SseSubscriber[${this.clientId}]: listener threw on reconnection`, err);
				}
			}
		};
		this.source.onmessage = (sseEvent: { data: string }) => {
			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(sseEvent.data);
			} catch {
				this.dispatch({ raw: sseEvent.data } as unknown as THaibunEvent);
				return;
			}
			// web-server-hono wraps events as { type: "event", event: {...} };
			// un-wrap when present, pass through otherwise. Server-side already validated against the schema.
			this.dispatch(msg.type === "event" && msg.event ? (msg.event as THaibunEvent) : (msg as unknown as THaibunEvent));
		};
		this.source.onerror = () => {
			// The break is announced once, when it happens: a page that cannot hear the run cannot say its reading is
			// current, and that is a fact of the reading rather than something to infer from the silence.
			const wasOpen = !this.broken;
			this.broken = true;
			if (wasOpen) {
				for (const fn of this.disconnectListeners) {
					try {
						fn();
					} catch (err) {
						failFastOrLog(`SseSubscriber[${this.clientId}]: listener threw on disconnection`, err);
					}
				}
			}
			this.source?.close?.();
			this.source = null;
			if (this.closed || this.reconnectTimer) return;
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = null;
				this.connect();
			}, this.reconnectDelayMs);
		};
	}

	/**
	 * Register a listener. Returns an unsubscribe function. The new handler
	 * synchronously receives every buffered event from the `ReplayBuffer`
	 * before subscribe returns, then continues to receive live dispatches.
	 */
	subscribe(handler: EventHandler, filter?: EventFilter): () => void {
		const entry = { handler, filter };
		this.listeners.push(entry);
		this.replayBuffer.replay(handler, filter);
		return () => {
			const idx = this.listeners.indexOf(entry);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	/**
	 * Be told the stream has re-opened after a break in it. What happened during the break arrives in no dispatch, so a
	 * consumer following the run reads again on this, as it reads again on an arrival. Never fires on the first open,
	 * which has nothing behind it. Returns an unsubscribe.
	 */
	reconnected(fn: () => void): () => void {
		this.reconnectListeners.add(fn);
		return () => this.reconnectListeners.delete(fn);
	}

	/** Be told the stream has broken. Until it re-opens, what the run does reaches no listener, so a consumer following
	 *  the run cannot say its reading is current. Fires once per break, and at once for a stream already down, so a
	 *  consumer that starts listening after the break is told what it would have heard. Returns an unsubscribe. */
	disconnected(fn: () => void): () => void {
		this.disconnectListeners.add(fn);
		if (this.broken) fn();
		return () => this.disconnectListeners.delete(fn);
	}

	/** Tag for log correlation. */
	get id(): string {
		return this.clientId;
	}

	/** Inspect the replay buffer. Exposed so consumers can report buffer size or drain it for debugging. */
	getReplayBuffer(): ReplayBuffer {
		return this.replayBuffer;
	}

	/** Close the connection and stop reconnecting. */
	close(): void {
		this.closed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.source?.close?.();
		this.source = null;
	}

	/** Wall-clock time of the last successfully-dispatched event, or null if none yet. */
	getLastEventAt(): number | null {
		return this.lastEventAt;
	}

	/** Wall-clock time when connect() was first called, or null if never connected. */
	getConnectedAt(): number | null {
		return this.connectedAt;
	}

	/**
	 * Latest known liveness timestamp: lastEventAt if any event has been received,
	 * otherwise connectedAt. Used by silence detectors so a peer that never emits
	 * is still distinguished from one that has yet to be subscribed.
	 */
	getLastActivityAt(): number | null {
		return this.lastEventAt ?? this.connectedAt;
	}

	private dispatch(event: THaibunEvent): void {
		this.lastEventAt = Date.now();
		this.replayBuffer.record(event);
		for (const { handler, filter } of this.listeners) {
			if (filter && !filter(event)) continue;
			// Live-dispatch isolation across listeners: a thrown handler must not
			// silence its siblings. `failFastOrLog` re-throws in DEV so the
			// developer sees the failure immediately; in PROD it logs and the
			// loop continues. Replay (in `subscribe`) stays fail-fast — a
			// listener that can't process a buffered event is a bug to surface.
			try {
				handler(event);
			} catch (err) {
				failFastOrLog(`SseSubscriber[${this.clientId}]: listener threw during dispatch`, err);
			}
		}
	}
}
