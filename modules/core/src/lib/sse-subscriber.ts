/**
 * sse-subscriber: the client shared by every consumer of a haibun host's
 * /sse event stream.
 *
 * Browser SPAs connect to their own origin's /sse; Node-side peers
 * connect to another host's /sse. Both need the same primitives: open,
 * dispatch parsed events to listeners, reconnect on error with backoff,
 * filter subscriptions, close cleanly. This class centralises that.
 *
 * The stream is read with fetch rather than EventSource, because a host's
 * stream requires authority and a request proves it in headers an
 * EventSource cannot send. The caller supplies the URL and the headers
 * each connection is asked for with; whether the URL is the same origin
 * or a remote host, and what the headers prove, is the caller's concern.
 *
 * The SSE message format this subscriber decodes is the one
 * web-server-hono's SSETransport emits: each `message` event's
 * `data` field is a JSON envelope with `{ type, event, ... }` or a
 * plain event payload. Payloads that don't parse as JSON are passed
 * through verbatim so callers can handle wire-format variants.
 *
 * --- Who follows the stream (`StreamListeners`) ---
 * The listeners, what the stream holds for a listener that starts late,
 * and whether the stream is open are kept by `StreamListeners`, which a
 * stream replayed from a log keeps too, so both answer a listener alike.
 * Every dispatched event is recorded in a fixed-size replay buffer, so a
 * `subscribe()` after the connection opened still sees what this page
 * received before it subscribed.
 *
 * --- Reconnection ---
 * The server doesn't replay events on connect: what happened is in the graph.
 * A stream that breaks and re-opens announces the re-open through
 * `reconnected()`, which is how a consumer following actuality knows to
 * read again for what happened while the stream didn't deliver an event.
 */

import { ACTUALITY_HEADER, type TActualityId } from "./rpc-wire.js";
import type { THaibunEvent } from "../schema/protocol.js";
import { failFastOrLog } from "./dev-mode.js";

/** Default cap for the replay buffer. Overrideable via SseSubscriberConfig. */
const REPLAY_BUFFER_LIMIT_DEFAULT = 5000;

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
 * Who follows a stream, what the stream holds for one who starts following late, and whether it is open: what a stream
 * read from a host and a stream replayed from a log both keep, so each tells a listener the same things at the same
 * moments.
 */
export class StreamListeners<E> {
	private readonly listeners: { handler: (event: E) => void; filter?: (event: E) => boolean }[] = [];
	private readonly openListeners = new Set<() => void>();
	private readonly reconnectListeners = new Set<() => void>();
	private readonly disconnectListeners = new Set<() => void>();
	/** The stream has dropped and not yet re-opened. What happened meanwhile didn't reach a listener, so the re-open is
	 *  announced to whoever follows actuality: that is when they have something to read again for. */
	private broken = false;
	private readonly buffer: ReplayBuffer<E>;

	/** `open` is whether the stream is open from the start, as a log that is all there is is. */
	constructor(
		private readonly name: string,
		replayLimit: number,
		private open = false,
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

	/** Be told the stream is open: at once for a stream open now, and each time it opens after. Returns an unsubscribe. */
	opened(fn: () => void): () => void {
		this.openListeners.add(fn);
		if (this.open) fn();
		return () => this.openListeners.delete(fn);
	}

	/** Be told the stream has re-opened after a break in it. What happened during the break doesn't arrive in a dispatch, so a
	 *  consumer following actuality reads again on this. Never fires on the first open, which doesn't follow a break. */
	reconnected(fn: () => void): () => void {
		this.reconnectListeners.add(fn);
		return () => this.reconnectListeners.delete(fn);
	}

	/** Be told the stream has broken: once per break, and at once for a stream already down, so a consumer that starts
	 *  listening after the break is told what it would have heard. Returns an unsubscribe. */
	disconnected(fn: () => void): () => void {
		this.disconnectListeners.add(fn);
		if (this.broken) fn();
		return () => this.disconnectListeners.delete(fn);
	}

	/** The stream is open, and after a break, back. */
	becameOpen(): void {
		this.open = true;
		this.notify(this.openListeners, "opening");
		if (!this.broken) return;
		this.broken = false;
		this.notify(this.reconnectListeners, "reconnection");
	}

	/** The stream broke. The break is announced once, when it happens: a page that cannot hear actuality cannot state its
	 *  reading is current, and that is a fact of the reading rather than something to infer from the silence. */
	broke(): void {
		const wasOpen = !this.broken;
		this.broken = true;
		this.open = false;
		if (wasOpen) this.notify(this.disconnectListeners, "disconnection");
	}

	/** Record an event and hand it to every listener whose filter takes it. A listener that throws is reported and its
	 *  siblings are still told; a listener that can't take a replayed event (in `subscribe`) is a fault to surface. */
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

	/** Let every listener go: a stream that closes never opens again, so a message it receives after doesn't reach a listener. */
	clear(): void {
		this.listeners.length = 0;
		this.openListeners.clear();
		this.reconnectListeners.clear();
		this.disconnectListeners.clear();
	}

	/** Tell each listener of a change to the stream; one that throws is reported and the others are still told. */
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

type SseSubscriberConfig = {
	/** Full URL of the SSE endpoint, absolute for remote hosts, relative for same-origin. */
	url: string;
	/** The actuality the stream is followed in, as the host's handshake answers it. */
	actualityId: TActualityId;
	/** Reconnect delay on error, in ms. Default 2000. */
	reconnectDelayMs?: number;
	/** The headers each connection is asked for with, made anew for each, since a proof covers the one request it is sent
	 *  with. Absent, the stream is requested without headers. */
	headers?: (url: string) => Promise<Record<string, string>>;
	/** The fetch the stream is read with. Defaults to globalThis.fetch. */
	fetchImpl?: typeof fetch;
	/** Short tag included in log lines to distinguish multiple subscribers. */
	clientId?: string;
	/** Cap for the per-subscriber replay buffer. Defaults to REPLAY_BUFFER_LIMIT_DEFAULT. */
	replayBufferLimit?: number;
};

export class SseSubscriber {
	private readonly url: string;
	private readonly actualityId: TActualityId;
	private readonly reconnectDelayMs: number;
	private readonly headers?: (url: string) => Promise<Record<string, string>>;
	private readonly fetchImpl: typeof fetch;
	private readonly clientId: string;
	/** Stops the connection being read, or null where a connection isn't open or opening. */
	private reading: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;
	private lastEventAt: number | null = null;
	private connectedAt: number | null = null;
	private readonly followers: StreamListeners<THaibunEvent>;

	constructor(config: SseSubscriberConfig) {
		this.url = config.url;
		this.actualityId = config.actualityId;
		this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
		this.headers = config.headers;
		this.fetchImpl = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
		this.clientId = config.clientId ?? `sse-${Math.random().toString(36).slice(2, 8)}`;
		this.followers = new StreamListeners<THaibunEvent>(`SseSubscriber[${this.clientId}]`, config.replayBufferLimit ?? REPLAY_BUFFER_LIMIT_DEFAULT);
	}

	/** Open the stream. Subsequent subscribe/close calls operate on this connection. Idempotent. */
	connect(): void {
		if (this.closed || this.reading) return;
		if (this.connectedAt === null) this.connectedAt = Date.now();
		const reading = new AbortController();
		this.reading = reading;
		void this.read(reading);
	}

	/** Read one connection until it ends, then treat its end as a break: a host's stream stays open while the host runs. */
	private async read(reading: AbortController): Promise<void> {
		try {
			const headers = { accept: "text/event-stream", [ACTUALITY_HEADER]: this.actualityId, ...(await this.headers?.(this.url)) };
			const res = await this.fetchImpl(this.url, { headers, signal: reading.signal });
			// A refusal is the host's answer about this caller, which asking again will not change: the stream is down, and
			// stays down until whoever follows it holds what following it takes, or follows the actuality the host holds.
			if (res.status === 400 || res.status === 401 || res.status === 403) {
				this.broke(false);
				return;
			}
			if (!res.ok || !res.body) throw new Error(`the stream at ${this.url} answered ${res.status}`);
			this.followers.becameOpen();
			for await (const data of sseData(res.body)) this.received(data);
		} catch {
			// What ended the connection is not what a listener acts on: it acts on the stream being down, which it is.
		}
		if (reading.signal.aborted) return;
		this.broke();
	}

	private received(data: string): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(data);
		} catch {
			this.dispatch({ raw: data } as unknown as THaibunEvent);
			return;
		}
		// web-server-hono wraps events as { type: "event", event: {...} };
		// un-wrap when present, pass through otherwise. Server-side already validated against the schema.
		this.dispatch(msg.type === "event" && msg.event ? (msg.event as THaibunEvent) : (msg as unknown as THaibunEvent));
	}

	private broke(retry = true): void {
		this.followers.broke();
		this.reading = null;
		if (!retry || this.closed || this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelayMs);
	}

	subscribe(handler: (event: THaibunEvent) => void, filter?: (event: THaibunEvent) => boolean): () => void {
		return this.followers.subscribe(handler, filter);
	}

	opened(fn: () => void): () => void {
		return this.followers.opened(fn);
	}

	reconnected(fn: () => void): () => void {
		return this.followers.reconnected(fn);
	}

	disconnected(fn: () => void): () => void {
		return this.followers.disconnected(fn);
	}

	/** Tag for log correlation. */
	get id(): string {
		return this.clientId;
	}

	/** Every event this stream has dispatched, including ones its replay buffer has since dropped. */
	totalRecorded(): number {
		return this.followers.totalRecorded();
	}

	/** Close the connection and stop reconnecting. */
	close(): void {
		this.closed = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reading?.abort();
		this.reading = null;
		// A closed subscriber never opens again, so it doesn't hold a listener: a message arriving on the transport it has let
		// go reaches a consumer that stopped listening otherwise.
		this.followers.clear();
	}

	/** Wall-clock time of the last successfully-dispatched event, or null if an event hasn't been dispatched yet. */
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
		this.followers.dispatch(event);
	}
}

/** The data of each message a Server-Sent Events body carries, its `data:` lines joined as the format joins them. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let pending = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		pending += decoder.decode(value, { stream: true });
		for (let end = pending.search(/\r?\n\r?\n/); end >= 0; end = pending.search(/\r?\n\r?\n/)) {
			const block = pending.slice(0, end);
			pending = pending.slice(end).replace(/^\r?\n\r?\n/, "");
			const data = block
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).replace(/^ /, ""));
			if (data.length > 0) yield data.join("\n");
		}
	}
}
