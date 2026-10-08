/**
 * EventStream is shu's one contract for the events a server pushes (lifecycle, log, time-sync). This file holds the
 * interface, both implementations and the accessor. Components and infrastructure subscribe through `eventStream()`.
 * Other shu modules don't construct an `SseSubscriber`.
 *
 * `LiveEventStream` wraps an `SseSubscriber` connection. The page signs its request for that connection where it holds a
 * delegation for `FOLLOWS_THE_RUN`. Following actuality requires that public read. A subscriber registered after
 * `connect` first receives the events in the replay buffer, then live events.
 *
 * `SerializedEventStream` serves tests and the offline shu.html report. The caller supplies events through `emit(event)`.
 * Subscribers registered before or after an `emit` receive the events in order. Tests drive scripted scenarios by calling
 * `emit` between assertions, `disconnect` to report a break and `reconnect` to report that the stream reopened.
 */

import { SseSubscriber, StreamListeners } from "@haibun/core/lib/sse-subscriber.js";
import { FOLLOWS_THE_RUN } from "@haibun/core/lib/actions.js";
import { deploymentMs, hydratedActualityId } from "./rpc-registry.js";
import { readingHeaders } from "./page-key.js";
import { pagePinned } from "./page-pinned.js";

export type TEvent = Record<string, unknown>;
type TEventHandler = (event: TEvent) => void;
export type TEventFilter = (event: TEvent) => boolean;

/** The one contract for subscribing to server-pushed events. The live and serialized implementations share this interface, so a component's code doesn't depend on which one is installed. */
export interface EventStream {
	/** Registers a handler. A given `filter` runs per event. Only matching events reach the handler. Returns an unsubscribe function. A new subscriber receives the buffered history during `subscribe`, before the next live event arrives. */
	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void;

	/** Opens the stream. App boot calls it before any view subscribes. The server sends events from the moment a page
	 *  connects and doesn't replay earlier events. A page that connects only when its first view is ready would lose the
	 *  events sent while it booted. The stream holds the events that arrive before a view subscribes and replays them to the
	 *  view. */
	connect(): void;

	/** Registers `fn` to run when the stream opens. It runs at once for an open stream, and each time the stream opens
	 *  again. The events actuality sends reach the handlers while the stream is open. Returns an unsubscribe. */
	opened(fn: () => void): () => void;

	/** Registers `fn` to run when the stream reopens after a break. The events sent during the break don't reach a handler.
	 *  A view that follows actuality reads again through its usual read path when `fn` runs. Returns an unsubscribe. */
	reconnected(fn: () => void): () => void;

	/** Registers `fn` to run when the stream breaks. A view that follows actuality can't report its reading as current until
	 *  the stream reopens, because actuality's events don't reach it. `fn` runs at once for a stream already down, in the
	 *  way `subscribe` replays the events it holds. A view that subscribes after the break then doesn't show a stale reading
	 *  as current. Returns an unsubscribe. */
	disconnected(fn: () => void): () => void;

	/** Returns the count of events ever recorded, including events the replay buffer has since dropped. The conformance cases read it to confirm a delivery. */
	totalRecorded(): number;

	/** Closes the underlying transport and removes all subscriptions. A `subscribe` call after `close` is a programming error in production, although it may still work against a no-op transport. */
	close(): void;
}

// ─── LiveEventStream ─────────────────────────────────────────────────────────

/** Returns the headers of the page's request for actuality's stream. They carry a signature under a delegation that allows following actuality where the page holds one. They are empty where the page doesn't hold one. */
const followingHeaders = (url: string): Promise<Record<string, string>> => readingHeaders(url, FOLLOWS_THE_RUN);

/** `EventStream` over a real `/sse` connection. An instance constructs its `SseSubscriber` on the first `subscribe`, `connect`, `opened`, `reconnected` or `disconnected` call. Only `connect` opens it. App boot installs one instance per page and calls `connect` after it reads the reader's authority and the available steps. */
export class LiveEventStream implements EventStream {
	private subscriber: SseSubscriber | null = null;

	constructor(private readonly url: string) {}

	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void {
		return this.ensure().subscribe(handler, filter);
	}

	connect(): void {
		this.ensure().connect();
	}

	opened(fn: () => void): () => void {
		return this.ensure().opened(fn);
	}

	reconnected(fn: () => void): () => void {
		return this.ensure().reconnected(fn);
	}

	disconnected(fn: () => void): () => void {
		return this.ensure().disconnected(fn);
	}

	totalRecorded(): number {
		return this.subscriber?.totalRecorded() ?? 0;
	}

	close(): void {
		this.subscriber?.close();
		this.subscriber = null;
	}

	private ensure(): SseSubscriber {
		if (!this.subscriber) {
			// The delay before the connection reopens after a break. The deployment's `streamReconnectAfterMs` sets it, else the subscriber's default applies.
			const reconnectDelayMs = deploymentMs("streamReconnectAfterMs");
			this.subscriber = new SseSubscriber({
				url: this.url,
				actualityId: hydratedActualityId(),
				headers: followingHeaders,
				...(reconnectDelayMs === undefined ? {} : { reconnectDelayMs }),
			});
		}
		return this.subscriber;
	}
}

// ─── SerializedEventStream ───────────────────────────────────────────────────

/** `EventStream` backed by an in-memory event log. A new subscriber first receives every event already emitted, then new ones. The live subscriber has the same contract, so consumer code doesn't depend on the source. */
export class SerializedEventStream implements EventStream {
	/** The log keeps every event it is given. It is open from construction, because it holds the whole record. */
	private readonly followers = new StreamListeners<TEvent>("SerializedEventStream", Number.POSITIVE_INFINITY, true);

	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void {
		return this.followers.subscribe(handler, filter);
	}

	connect(): void {
		// The log is open from construction, so `connect` doesn't change its state.
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

	/** Reports a break in the stream, so a scripted scenario drives a view's reading as a break does. An offline report
	 *  doesn't call it, because a log that holds the whole record doesn't break. */
	disconnect(): void {
		this.followers.broke();
	}

	/** Reports that the stream reopened after a break, so a scripted scenario drives a view's catch-up as it drives arrivals. */
	reconnect(): void {
		this.followers.becameOpen();
	}

	/** Appends an event to the log and dispatches it to every matching subscriber. */
	emit(event: TEvent): void {
		this.followers.dispatch(event);
	}

	totalRecorded(): number {
		return this.followers.totalRecorded();
	}

	close(): void {
		this.followers.clear();
	}
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/** The page pins the active EventStream, so independently bundled components share one installation instead of a module-level cell each. esbuild emits a bundle per slot extension, for example. A slot-extension component bundle wouldn't see the SPA bundle's `setEventStream` without the pin. Its `eventStream()` would then throw at first use. */
const EVENT_STREAM_KEY = "__SHU_EVENT_STREAM__";
const installedStream = (): { stream?: EventStream } => pagePinned(EVENT_STREAM_KEY, () => ({}));

/** Installs the page's live or serialized EventStream. SPA boot installs one. Every component and infrastructure module reads it through `eventStream()`. */
export function setEventStream(s: EventStream): void {
	installedStream().stream = s;
}

/** Returns whether an EventStream is installed. A static context may not install one, as in a unit test that doesn't
 *  drive events. A component checks this before subscribing rather than force a stream. */
export function hasEventStream(): boolean {
	return installedStream().stream !== undefined;
}

/** Returns the active EventStream. Throws where boot didn't install one. In production that is a programming error in `app.ts`. The thrown message names the fix for a test that doesn't call `setupShuTest`. */
export function eventStream(): EventStream {
	const active = installedStream().stream;
	if (!active) {
		throw new Error("eventStream: an EventStream isn't installed. Call setEventStream() in app boot or setupShuTest() in tests before using eventStream().");
	}
	return active;
}

/** Subscribes to the stream and coalesces the events that arrive between paints into one `onBatch` call inside an
 *  animation frame. Returns an unsubscribe. `ShuElement.subscribeBatched` calls this `this`-free form. The entity store,
 *  `conversation.ts` and `app.ts` call it directly. A caller doesn't construct an `SseSubscriber`. `onReconnect` runs when
 *  the stream reopens after a break. The caller reads again through the same path it uses for an arrival. `onDisconnect`
 *  runs when the stream breaks. */
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
