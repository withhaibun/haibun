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
 */

import type { THaibunEvent } from "../schema/protocol.js";

type EventHandler = (event: THaibunEvent) => void;
type EventFilter = (event: THaibunEvent) => boolean;

// biome-ignore lint/suspicious/noExplicitAny: EventSource is a DOM/Node global that may be polyfilled.
type EventSourceCtor = new (url: string) => any;

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
	private lastEventAt: number | null = null;
	private connectedAt: number | null = null;

	constructor(config: SseSubscriberConfig) {
		this.url = config.url;
		this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
		const ctor = config.EventSourceCtor ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource;
		if (!ctor) {
			throw new Error("SseSubscriber: no EventSource constructor available (set SseSubscriberConfig.EventSourceCtor)");
		}
		this.EventSourceCtor = ctor;
		this.clientId = config.clientId ?? `sse-${Math.random().toString(36).slice(2, 8)}`;
	}

	/** Open the stream. Subsequent subscribe/close calls operate on this connection. Idempotent. */
	connect(): void {
		if (this.closed) return;
		if (this.source) return;
		if (this.connectedAt === null) this.connectedAt = Date.now();
		this.source = new this.EventSourceCtor(this.url);
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
			const payload = msg.type === "event" && msg.event ? (msg.event as THaibunEvent) : (msg as unknown as THaibunEvent);
			this.dispatch(payload);
		};
		this.source.onerror = () => {
			this.source?.close?.();
			this.source = null;
			if (this.closed || this.reconnectTimer) return;
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = null;
				this.connect();
			}, this.reconnectDelayMs);
		};
	}

	/** Register a listener. Returns an unsubscribe function. */
	subscribe(handler: EventHandler, filter?: EventFilter): () => void {
		const entry = { handler, filter };
		this.listeners.push(entry);
		return () => {
			const idx = this.listeners.indexOf(entry);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	/** Tag for log correlation. */
	get id(): string {
		return this.clientId;
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
		for (const { handler, filter } of this.listeners) {
			try {
				if (!filter || filter(event)) handler(event);
			} catch {
				// Listener errors don't take down the subscriber.
			}
		}
	}
}
