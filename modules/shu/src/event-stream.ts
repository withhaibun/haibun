/**
 * EventStream — shu's single contract for inbound server-pushed events
 * (lifecycle, log, time-sync). One file holds the interface, both
 * implementations, and the accessor. Components and infrastructure subscribe
 * via `eventStream()`; nothing else touches `EventSource` or `SseSubscriber`.
 *
 * `LiveEventStream` wraps the shared `SseSubscriber` connection. Subscribers
 * registered after connect receive what the page received before they
 * subscribed, then live events.
 *
 * `SerializedEventStream` powers tests and the offline shu.html report. The
 * caller provides events via `emit(event)`; subscribers registered before or
 * after the emit see them in order. Tests drive scripted scenarios by calling
 * `emit` between assertions, and `reconnect` to say the stream came back.
 */

import { SseSubscriber } from "@haibun/core/lib/sse-subscriber.js";
import { deploymentMs } from "./rpc-registry.js";

/** How long after the stream breaks the page opens it again, where the deployment sets nothing. */
const STREAM_RECONNECT_AFTER_MS = 2000;

export type TEvent = Record<string, unknown>;
export type TEventHandler = (event: TEvent) => void;
export type TEventFilter = (event: TEvent) => boolean;

/** The single contract for subscribing to server-pushed events. Live and serialized implementations share this surface so components are unaware which is installed. */
export interface EventStream {
	/** Register a handler. `filter` (if given) is consulted per-event; only matching events reach the handler. Returns an unsubscribe function. New subscribers immediately receive any buffered history before the next live event arrives. */
	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void;

	/** Open the stream now, before any view subscribes. The server announces from the moment a page connects and
	 *  replays nothing, so a page that connects only when its first view is ready loses what happened while it booted;
	 *  what arrives before a view subscribes is held for it. */
	connect(): void;

	/** Be told the stream has come back after a break in it. What happened during the break reaches no handler, so a
	 *  view following the run reads again on this through the path it already reads on. Returns an unsubscribe. */
	reconnected(fn: () => void): () => void;

	/** Be told the stream has broken: from then until it comes back, a view following the run cannot say its reading
	 *  is current, since what the run does reaches it no more. A stream already down says so at once, as `subscribe`
	 *  replays what it holds, so a view that starts listening after the break is not left believing it is current.
	 *  Returns an unsubscribe. */
	disconnected(fn: () => void): () => void;

	/** Total events ever recorded (including ones the replay buffer has since dropped). Used by the timeline to label the slider knob `current / count / total`. */
	totalRecorded(): number;

	/** Cleanup: close the underlying transport and drop all subscriptions. After `close`, `subscribe` may continue to work against a no-op transport but should be treated as a programming error in production. */
	close(): void;
}

// ─── LiveEventStream ─────────────────────────────────────────────────────────

/** `EventStream` over a real `/sse` connection. One shared `SseSubscriber` regardless of how many `LiveEventStream` instances exist; constructed lazily on first `subscribe`. */
export class LiveEventStream implements EventStream {
	private subscriber: SseSubscriber | null = null;

	constructor(private readonly url: string = "/sse") {}

	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void {
		return this.ensure().subscribe(handler, filter);
	}

	connect(): void {
		this.ensure();
	}

	reconnected(fn: () => void): () => void {
		return this.ensure().reconnected(fn);
	}

	disconnected(fn: () => void): () => void {
		return this.ensure().disconnected(fn);
	}

	totalRecorded(): number {
		return this.subscriber?.getReplayBuffer().totalRecorded ?? 0;
	}

	close(): void {
		this.subscriber?.close();
		this.subscriber = null;
	}

	private ensure(): SseSubscriber {
		if (!this.subscriber) {
			this.subscriber = new SseSubscriber({ url: this.url, reconnectDelayMs: deploymentMs("streamReconnectAfterMs", STREAM_RECONNECT_AFTER_MS) });
			this.subscriber.connect();
		}
		return this.subscriber;
	}
}

// ─── SerializedEventStream ───────────────────────────────────────────────────

/** `EventStream` backed by an in-memory event log. New subscribers first receive every event already emitted, then new ones, the contract the live subscriber has, so consumer code is unaware of the source. */
export class SerializedEventStream implements EventStream {
	private readonly history: TEvent[] = [];
	private readonly subscribers = new Set<{ handler: TEventHandler; filter?: TEventFilter }>();
	private readonly reconnectListeners = new Set<() => void>();
	private readonly disconnectListeners = new Set<() => void>();
	private broken = false;
	private recorded = 0;

	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void {
		const entry = { handler, filter };
		this.subscribers.add(entry);
		for (const event of this.history) {
			if (!filter || filter(event)) handler(event);
		}
		return () => {
			this.subscribers.delete(entry);
		};
	}

	connect(): void {
		// A log that is all there is open already.
	}

	reconnected(fn: () => void): () => void {
		this.reconnectListeners.add(fn);
		return () => this.reconnectListeners.delete(fn);
	}

	disconnected(fn: () => void): () => void {
		this.disconnectListeners.add(fn);
		if (this.broken) fn();
		return () => this.disconnectListeners.delete(fn);
	}

	/** Say the stream broke, so a scripted scenario drives a view's reading the way a break does. An offline reading
	 *  never calls it: a log that is all there never breaks. */
	disconnect(): void {
		this.broken = true;
		for (const fn of this.disconnectListeners) fn();
	}

	/** Say the stream came back, so a scripted scenario drives a view's catch-up the way it drives arrivals. */
	reconnect(): void {
		this.broken = false;
		for (const fn of this.reconnectListeners) fn();
	}

	/** Append an event to the log and dispatch it to every matching subscriber. */
	emit(event: TEvent): void {
		this.history.push(event);
		this.recorded += 1;
		for (const { handler, filter } of this.subscribers) {
			if (!filter || filter(event)) handler(event);
		}
	}

	totalRecorded(): number {
		return this.recorded;
	}

	close(): void {
		this.subscribers.clear();
	}
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/** The active EventStream lives on `globalThis` under a globally-registered Symbol so independently-bundled components (e.g. esbuild emits per-slot-extension bundles) share one installation instead of each carrying its own module-level cell. Without this, `setEventStream` in the SPA bundle wouldn't be visible to a slot-extension component bundle, and its `eventStream()` would throw at first use. */
const EVENT_STREAM_SLOT = Symbol.for("@haibun/shu/active-event-stream");
type EventStreamGlobal = { [EVENT_STREAM_SLOT]?: EventStream | null };
const eventStreamGlobal = globalThis as EventStreamGlobal;

/** SPA boot installs one EventStream (live or serialized); every component and infrastructure module reads via `eventStream()`. */
export function setEventStream(s: EventStream): void {
	eventStreamGlobal[EVENT_STREAM_SLOT] = s;
}

/** Whether a live EventStream is installed. A static context (offline report bundle, a unit test that doesn't drive
 *  live events) legitimately has none — a component checks this before subscribing rather than forcing a stream. */
export function hasEventStream(): boolean {
	return eventStreamGlobal[EVENT_STREAM_SLOT] != null;
}

/** Returns the active EventStream. Throws if boot didn't install one — the only way this happens in production is a programming error in `app.ts`; in tests every `beforeEach` calls `setupShuTest`, so a forgotten setup throws with a precise message. */
export function eventStream(): EventStream {
	const active = eventStreamGlobal[EVENT_STREAM_SLOT];
	if (!active) {
		throw new Error("eventStream: no EventStream installed. Call setEventStream() in app boot or setupShuTest() in tests before using eventStream().");
	}
	return active;
}

/** Test-only: clear the active EventStream so subsequent setEventStream calls are clean. Used by test setup. */
export function resetEventStream(): void {
	eventStreamGlobal[EVENT_STREAM_SLOT] = null;
}

/** Subscribe to the stream, coalescing every event arriving between paints into one `onBatch` call inside an animation
 *  frame. Returns an unsubscribe. The `this`-free form shared by `ShuElement.subscribeBatched` and the data controllers;
 *  no caller constructs `EventSource`/`SseSubscriber` directly. `onReconnect` fires when the stream comes back after a
 *  break: the same reason to read again as an arrival, on the same path. */
export function subscribeBatchedEvents(opts: { onBatch: (events: TEvent[]) => void; filter?: TEventFilter; onReconnect?: () => void; onDisconnect?: () => void }): () => void {
	let pending: TEvent[] = [];
	let scheduled = false;
	let active = true;
	const drain = () => {
		scheduled = false;
		if (!active || pending.length === 0) return;
		const batch = pending;
		pending = [];
		opts.onBatch(batch);
	};
	const stream = eventStream();
	const stopReconnects = opts.onReconnect
		? stream.reconnected(() => {
				if (active) opts.onReconnect?.();
			})
		: () => undefined;
	const stopDisconnects = opts.onDisconnect
		? stream.disconnected(() => {
				if (active) opts.onDisconnect?.();
			})
		: () => undefined;
	const innerUnsub = stream.subscribe((event) => {
		if (!active) return;
		pending.push(event);
		if (!scheduled) {
			scheduled = true;
			requestAnimationFrame(drain);
		}
	}, opts.filter);
	return () => {
		active = false;
		pending = [];
		stopReconnects();
		stopDisconnects();
		innerUnsub();
	};
}
