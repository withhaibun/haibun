import type { ReactiveController, ReactiveControllerHost } from "lit";
import { registerWindow, unregisterWindow, eventsInWindow, eventsLoaded, mergeEvents, newWindowClientId, FULL_WINDOW, type TEventRecord } from "../events-snapshot.js";
import { subscribeBatchedEvents } from "../event-stream.js";

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
	#initialized = false;
	#teardown?: () => void;
	#clientId = newWindowClientId();

	constructor(host: ReactiveControllerHost & Element, onChange: () => void) {
		this.#host = host;
		this.#onChange = onChange;
		host.addController(this);
	}

	async hostConnected(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		try {
			await registerWindow(this.#clientId, [FULL_WINDOW]); // shared: the window's gap is fetched once, cached for every consumer
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

	/** The events inside this view's window (deduped, time-sorted). The full-window default = the whole shared log. */
	get all(): TEventRecord[] {
		return eventsInWindow(this.#clientId);
	}

	/** Whether the window fetch has completed: lets a view show "retrieving" vs "retrieved, and empty" — never a false "no data". */
	get loaded(): boolean {
		return eventsLoaded();
	}

	/** Await this view's window being loaded — a selector view (e.g. step-detail) awaits this before reading `all` on demand. */
	ensureLoaded(): Promise<void> {
		return registerWindow(this.#clientId, [FULL_WINDOW]);
	}
}
