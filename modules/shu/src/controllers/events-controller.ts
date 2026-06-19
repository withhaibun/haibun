import type { ReactiveController, ReactiveControllerHost } from "lit";
import { getEventSnapshot, currentEvents, mergeEvents, type TEventRecord } from "../events-snapshot.js";
import { subscribeBatchedEvents } from "../event-stream.js";

/**
 * EventsController — the per-view handle to the event/log stream. A view that renders events HOLDS one
 * (`#events = new EventsController(this, () => this.onEventsChanged())`); it never wires the SSE subscription or the
 * backfill itself. On connect it pages the full history once (shared, via `events-snapshot`), then merges live SSE
 * batches under one dedup and calls the view back; on disconnect it tears the subscription down. `events-snapshot.ts` is
 * the singleton backing store shared across every consumer and bundle. See ./index.ts; data-access.test.ts enforces it.
 */
export class EventsController implements ReactiveController {
	#host: ReactiveControllerHost & Element;
	#onChange: () => void;
	#initialized = false;
	#teardown?: () => void;

	constructor(host: ReactiveControllerHost & Element, onChange: () => void) {
		this.#host = host;
		this.#onChange = onChange;
		host.addController(this);
	}

	async hostConnected(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		try {
			await getEventSnapshot(); // shared: pages the full history once, cached for every consumer
		} catch {
			/* stepper may not be loaded yet */
		}
		this.#onChange();
		if (this.#host.hasAttribute("data-snapshot-time")) return; // snapshot mode: one backfill, no live updates
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
	}

	/** The full shared event log (deduped, arrival order). */
	get all(): TEventRecord[] {
		return currentEvents();
	}

	/** Await the shared backfill — a selector view (e.g. step-detail) awaits this before reading `all` on demand. */
	ensureLoaded(): Promise<void> {
		return getEventSnapshot().then(() => undefined);
	}
}
