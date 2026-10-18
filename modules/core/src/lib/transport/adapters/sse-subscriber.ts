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
 * `StreamListeners` (stream-listeners.ts) holds the listeners, the events
 * replayed to a listener that subscribes late, and whether the stream is
 * open. A `subscribe()` after the connection opened receives the buffered
 * events first.
 *
 * --- Reconnection ---
 * The server doesn't replay events on connect. The graph holds actuality's
 * records. A stream that breaks and re-opens calls each `reconnected()`
 * listener. A consumer that follows actuality then reads the graph again to
 * get the records of the events the stream didn't deliver during the break.
 */

import { ACTUALITY_HEADER, type TActualityId } from "../domains/rpc-wire.js";
import type { THaibunEvent } from "../../domains/protocol.js";
import { REPLAY_BUFFER_LIMIT, StreamListeners } from "./stream-listeners.js";

/** Whether a break connects the stream again: a refused connection stays down, and a stream that ended connects again. */
const STAYS_DOWN = false;
const CONNECTS_AGAIN = true;

type SseSubscriberConfig = {
	/** The SSE endpoint's URL. It is absolute for a remote host and relative for the same origin. */
	url: string;
	/** The id of the actuality the stream follows, as the host's handshake returns it. */
	actualityId: TActualityId;
	/** The delay before a broken stream connects again, in ms. A subscriber that doesn't state it waits `RECONNECT_DELAY_MS`. */
	reconnectDelayMs?: number;
	/** Returns the headers of each connection request. It runs for each request, since a proof covers one request. A
	 *  request carries only the accept and actuality headers where this is absent. */
	headers?: (url: string) => Promise<Record<string, string>>;
	/** The fetch that reads the stream, such as a test's. A subscriber that isn't given one reads through the global fetch. */
	fetchImpl?: typeof fetch;
	/** A short tag in log lines that distinguishes this subscriber from others. A subscriber that isn't given one takes a random tag. */
	clientId?: string;
	/** How many events the replay buffer holds. A subscriber that doesn't state it holds `REPLAY_BUFFER_LIMIT`. */
	replayBufferLimit?: number;
};

/** The delay before a broken stream connects again, where its subscriber doesn't state it. */
const RECONNECT_DELAY_MS = 2000;

export class SseSubscriber {
	private readonly url: string;
	private readonly actualityId: TActualityId;
	private readonly reconnectDelayMs: number;
	private readonly headers?: (url: string) => Promise<Record<string, string>>;
	private readonly fetchImpl?: typeof fetch;
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
		const { reconnectDelayMs, clientId, replayBufferLimit } = config;
		this.reconnectDelayMs = reconnectDelayMs === undefined ? RECONNECT_DELAY_MS : reconnectDelayMs;
		this.headers = config.headers;
		this.fetchImpl = config.fetchImpl;
		this.clientId = clientId === undefined ? `sse-${Math.random().toString(36).slice(2, 8)}` : clientId;
		this.followers = new StreamListeners<THaibunEvent>(`SseSubscriber[${this.clientId}]`, replayBufferLimit === undefined ? REPLAY_BUFFER_LIMIT : replayBufferLimit, false);
	}

	/** Sends a request through the fetch this subscriber was given, or through the global fetch where it wasn't given one. */
	private send(url: string, init: RequestInit): Promise<Response> {
		return this.fetchImpl === undefined ? fetch(url, init) : this.fetchImpl(url, init);
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
			const res = await this.send(this.url, { headers, signal: reading.signal });
			// A refusal is the host's response to this caller, and a repeated request receives the same response. The stream
			// stays down, and this subscriber doesn't retry. A later connect() requests the stream again. That request
			// succeeds once the caller holds the authority the stream requires or follows the actuality the host holds.
			if (res.status === 400 || res.status === 401 || res.status === 403) {
				this.broke(STAYS_DOWN);
				return;
			}
			if (!res.ok || !res.body) throw new Error(`the stream at ${this.url} responded with status ${res.status}`);
			this.followers.becameOpen();
			for await (const data of sseData(res.body)) this.received(data);
		} catch {
			// A listener acts on the stream being down and not on the cause, so this catch discards the error.
		}
		if (reading.signal.aborted) return;
		this.broke(CONNECTS_AGAIN);
	}

	private received(data: string): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(data);
		} catch {
			this.dispatch({ raw: data } as unknown as THaibunEvent);
			return;
		}
		// web-server-hono wraps an event as { type: "event", event: {...} }. This unwraps that envelope and dispatches any
		// other message unchanged. The server validates each event against the schema.
		this.dispatch(msg.type === "event" && msg.event ? (msg.event as THaibunEvent) : (msg as unknown as THaibunEvent));
	}

	private broke(retry: boolean): void {
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
