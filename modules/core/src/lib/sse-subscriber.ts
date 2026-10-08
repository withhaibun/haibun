/**
 * sse-subscriber implements the client that every consumer of a haibun
 * host's /sse event stream uses.
 *
 * A browser SPA connects to its own origin's /sse. A Node-side peer
 * connects to another host's /sse. Both use the same operations: open,
 * dispatch parsed events to listeners, reconnect after a fixed delay when
 * a connection fails or ends, filter subscriptions and close. SseSubscriber
 * implements them once.
 *
 * SseSubscriber reads the stream with fetch and not EventSource. A host's
 * stream requires authority, and a request proves it in headers that
 * EventSource can't send. The caller supplies the URL and the headers of
 * each connection request. The caller determines whether the URL is the
 * same origin or a remote host, and what the headers prove.
 *
 * This subscriber decodes the SSE message format that web-server-hono's
 * SSETransport emits. Each message's `data` field holds a JSON envelope
 * `{ type, event, ... }` or a plain event payload. A payload that doesn't
 * parse as JSON is dispatched as `{ raw: data }`, so a listener can handle
 * other wire formats.
 *
 * --- Listeners (`StreamListeners`) ---
 * `StreamListeners` holds the listeners, the events replayed to a listener
 * that subscribes late, and whether the stream is open. A stream replayed
 * from a log uses `StreamListeners` too, so both streams notify a listener
 * alike. `StreamListeners` records every dispatched event in a fixed-size
 * replay buffer.
 * A `subscribe()` after the connection opened receives the buffered events
 * first.
 *
 * --- Reconnection ---
 * The server doesn't replay events on connect. The graph holds actuality's
 * records. A stream that breaks and re-opens calls each `reconnected()`
 * listener. A consumer that follows actuality then reads the graph again to
 * get the records of the events the stream didn't deliver during the break.
 */

import { ACTUALITY_HEADER, type TActualityId } from "./rpc-wire.js";
import type { THaibunEvent } from "../schema/protocol.js";
import { failFastOrLog } from "./dev-mode.js";

/** Default cap for the replay buffer. SseSubscriberConfig.replayBufferLimit overrides it. */
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

type SseSubscriberConfig = {
	/** The SSE endpoint's URL. It is absolute for a remote host and relative for the same origin. */
	url: string;
	/** The id of the actuality the stream follows, as the host's handshake returns it. */
	actualityId: TActualityId;
	/** Reconnect delay on error, in ms. Default 2000. */
	reconnectDelayMs?: number;
	/** Returns the headers of each connection request. It runs for each request, since a proof covers one request. A
	 *  request carries only the accept and actuality headers where this is absent. */
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
	/** Aborts the connection being read. It is null where a connection isn't open or opening. */
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

	/** Opens the stream. It doesn't open a second connection while one is open or opening, and it doesn't open one after
	 *  close(). */
	connect(): void {
		if (this.closed || this.reading) return;
		if (this.connectedAt === null) this.connectedAt = Date.now();
		const reading = new AbortController();
		this.reading = reading;
		void this.read(reading);
	}

	/** Reads one connection until it ends, and treats its end as a break, since a host's stream stays open while the host runs. */
	private async read(reading: AbortController): Promise<void> {
		try {
			const headers = { accept: "text/event-stream", [ACTUALITY_HEADER]: this.actualityId, ...(await this.headers?.(this.url)) };
			const res = await this.fetchImpl(this.url, { headers, signal: reading.signal });
			// A refusal is the host's response to this caller, and a repeated request receives the same response. The stream
			// stays down, and this subscriber doesn't retry. A later connect() requests the stream again. That request
			// succeeds once the caller holds the authority the stream requires or follows the actuality the host holds.
			if (res.status === 400 || res.status === 401 || res.status === 403) {
				this.broke(false);
				return;
			}
			if (!res.ok || !res.body) throw new Error(`the stream at ${this.url} responded with status ${res.status}`);
			this.followers.becameOpen();
			for await (const data of sseData(res.body)) this.received(data);
		} catch {
			// A listener acts on the stream being down and not on the cause, so this catch discards the error.
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
		// web-server-hono wraps an event as { type: "event", event: {...} }. This unwraps that envelope and passes any
		// other message through. The server validates each event against the schema.
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
		// A closed subscriber never opens again. It removes its listeners, so a message that arrives on the aborted transport
		// doesn't reach a consumer that stopped listening.
		this.followers.clear();
	}

	/** Wall-clock time of the last dispatched event, or null where an event hasn't been dispatched. */
	getLastEventAt(): number | null {
		return this.lastEventAt;
	}

	/** Wall-clock time when connect() was first called, or null where connect() hasn't been called. */
	getConnectedAt(): number | null {
		return this.connectedAt;
	}

	/**
	 * The latest liveness timestamp: lastEventAt where an event has been dispatched,
	 * else connectedAt. A silence detector reads it to distinguish a peer that doesn't
	 * emit from one that hasn't connected.
	 */
	getLastActivityAt(): number | null {
		return this.lastEventAt ?? this.connectedAt;
	}

	private dispatch(event: THaibunEvent): void {
		this.lastEventAt = Date.now();
		this.followers.dispatch(event);
	}
}

/** Yields the data of each message in a Server-Sent Events body. A message's `data:` lines are joined with a newline, as
 *  the format specifies. */
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
