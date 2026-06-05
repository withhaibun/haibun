/**
 * EventStream — shu's single contract for inbound server-pushed events
 * (lifecycle, log, time-sync). One file holds the interface, both
 * implementations, and the accessor. Components and infrastructure subscribe
 * via `eventStream()`; nothing else touches `EventSource` or `SseSubscriber`.
 *
 * `LiveEventStream` wraps the shared `SseSubscriber` connection. Subscribers
 * registered after connect receive the replay-buffer history before any new
 * events arrive (same contract as the live subscriber).
 *
 * `SerializedEventStream` powers tests and the offline shu.html report. The
 * caller provides events via `emit(event)`; subscribers registered before or
 * after the emit see them in order. Tests drive scripted scenarios by calling
 * `emit` between assertions; the offline boot replays a captured event log.
 */

import { SseSubscriber } from "@haibun/core/lib/sse-subscriber.js";

export type TEvent = Record<string, unknown>;
export type TEventHandler = (event: TEvent) => void;
export type TEventFilter = (event: TEvent) => boolean;

/** The single contract for subscribing to server-pushed events. Live and serialized implementations share this surface so components are unaware which is installed. */
export interface EventStream {
	/** Register a handler. `filter` (if given) is consulted per-event; only matching events reach the handler. Returns an unsubscribe function. New subscribers immediately receive any buffered history before the next live event arrives. */
	subscribe(handler: TEventHandler, filter?: TEventFilter): () => void;

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

	totalRecorded(): number {
		return this.subscriber?.getReplayBuffer().totalRecorded ?? 0;
	}

	close(): void {
		this.subscriber?.close();
		this.subscriber = null;
	}

	private ensure(): SseSubscriber {
		if (!this.subscriber) {
			this.subscriber = new SseSubscriber({ url: this.url });
			this.subscriber.connect();
		}
		return this.subscriber;
	}
}

// ─── SerializedEventStream ───────────────────────────────────────────────────

/** `EventStream` backed by an in-memory event log. New subscribers first receive every event already emitted, then new ones — same replay contract as the live subscriber, so consumer code is unaware of the source. */
export class SerializedEventStream implements EventStream {
	private readonly history: TEvent[] = [];
	private readonly subscribers = new Set<{ handler: TEventHandler; filter?: TEventFilter }>();
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
