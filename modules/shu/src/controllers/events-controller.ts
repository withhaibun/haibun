import type { ReactiveController, ReactiveControllerHost } from "lit";
import { registerWindow, unregisterWindow, eventsInWindow, eventsLoaded, mergeEvents, newWindowClientId, FULL_WINDOW, type TEventRecord } from "../events-snapshot.js";
import type { Range } from "../ranges.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { eventTime } from "../event-backfill.js";

/** A view's time window over the shared log. Default (no hook, or hook returns none) = the full span, so a view that
 *  declares nothing sees the whole history exactly as before. A view that wants to bound its memory (e.g. the monitor
 *  following the live tail) supplies a hook returning its current span and calls `updateWindow()` when that span moves. */
export type WindowHook = () => Range[];

/**
 * EventsController — the per-view handle to the event/log stream. A view that renders events HOLDS one
 * (`#events = new EventsController(this, () => this.onEventsChanged())`); it never wires the SSE subscription or the
 * window fetch itself. On connect it registers its time window with the shared range-windowed cache (`events-snapshot`)
 * — the full span by default, so it sees the whole history with no behaviour change — then merges live SSE batches and
 * calls the view back; on disconnect it drops its window (whose spans are evicted if no other view wants them). The
 * shared cache fetches each span once across every consumer and bundle. See ./index.ts; data-access.test.ts enforces it.
 */
export class EventsController implements ReactiveController {
	#host: ReactiveControllerHost & Element;
	#onChange: () => void;
	#getWindow?: WindowHook;
	#initialized = false;
	#teardown?: () => void;
	#clientId = newWindowClientId();

	constructor(host: ReactiveControllerHost & Element, onChange: () => void, getWindow?: WindowHook) {
		this.#host = host;
		this.#onChange = onChange;
		this.#getWindow = getWindow;
		host.addController(this);
	}

	/** The span(s) this view wants right now — the hook's answer, or the full window when it declares nothing. */
	#windowRanges(): Range[] {
		const ranges = this.#getWindow?.();
		return ranges && ranges.length > 0 ? ranges : [FULL_WINDOW];
	}

	async hostConnected(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		try {
			await registerWindow(this.#clientId, this.#windowRanges()); // shared: each span is fetched once, cached for every consumer
		} catch {
			/* stepper may not be loaded yet */
		}
		this.#onChange();
		if (this.#host.hasAttribute("data-snapshot-time")) return; // snapshot mode: one fetch, no live updates
		this.#teardown = subscribeBatchedEvents({
			onBatch: (events) => {
				mergeEvents(events); // into the shared log (deduped); a sibling consumer's merge of the same batch is a no-op
				this.#onChange();
			},
		});
	}

	hostDisconnected(): void {
		this.#teardown?.();
		this.#teardown = undefined;
		this.#initialized = false;
		void unregisterWindow(this.#clientId);
	}

	/** Re-read the host's window and re-register it, then re-derive. The host calls this when its span moves — the monitor
	 *  as it follows the live edge (slide) or the reader scrolls back to older events (widen). Reconcile fetches any new
	 *  gap and evicts spans no window still wants, so memory tracks the union of live windows, not the whole history. */
	async updateWindow(): Promise<void> {
		if (!this.#initialized) return;
		try {
			await registerWindow(this.#clientId, this.#windowRanges());
		} catch {
			/* stepper may not be loaded yet */
		}
		this.#onChange();
	}

	/** The events inside this view's window (deduped, time-sorted). The full-window default = the whole shared log. */
	get all(): TEventRecord[] {
		return eventsInWindow(this.#clientId);
	}

	/** Whether the window fetch has completed: lets a view show "retrieving" vs "retrieved, and empty" — never a false "no data". */
	get loaded(): boolean {
		return eventsLoaded();
	}

	/** When the run this view can see starts and ends. `all` is time-sorted, so this is its two ends rather than a scan,
	 *  and rather than each view keeping its own running minimum and maximum off the live stream. It is the span of what
	 *  is HELD: a window that has evicted an early span starts where the held events do, which is also as far back as a
	 *  view could take a reader. Both ends are 0 before anything has happened. */
	get span(): { first: number; last: number } {
		const events = this.all;
		return events.length === 0 ? { first: 0, last: 0 } : { first: eventTime(events[0]), last: eventTime(events[events.length - 1]) };
	}

	/** Await this view's window being loaded — a selector view (e.g. step-detail) awaits this before reading `all` on demand. */
	ensureLoaded(): Promise<void> {
		return registerWindow(this.#clientId, this.#windowRanges());
	}
}
