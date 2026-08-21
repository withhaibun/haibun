import type { ReactiveController, ReactiveControllerHost } from "lit";
import { registerWindow, registerTail, unregisterWindow, eventsInWindow, eventsLoaded, eventsUnavailable, atRunStart, mergeEvents, newWindowClientId, FULL_WINDOW, type TEventRecord } from "../events-snapshot.js";
import type { Range } from "../ranges.js";
import { subscribeBatchedEvents } from "../event-stream.js";

/** A view's claim on the shared log: spans of time (one step's span), or a TAIL counted in events (the newest `tail`,
 *  the way a virtualized view holds a page). Default (no hook, or a hook answering none) = the full span. */
export type TEventWindow = Range[] | { tail: number };
export type WindowHook = () => TEventWindow | Promise<TEventWindow>;

/**
 * EventsController — the per-view handle to the event/log stream. A view that renders events HOLDS one
 * (`#events = new EventsController(this, () => this.onEventsChanged(), () => this.window())`); it never wires the SSE
 * subscription or the fetch itself. On connect it registers its claim with the shared windowed cache (`events-snapshot`),
 * then merges live SSE batches and calls the view back; on disconnect it drops its claim (whose spans are evicted if no
 * other view wants them). The shared cache fetches each span once across every consumer and bundle, from the device's own
 * store first. See ./index.ts; data-access.test.ts enforces it.
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

	/** Register this view's claim as it stands now. A claim the cache cannot satisfy is not an error here: the cache records
	 *  why (`unavailable`) and what IS held still renders; the view says the rest. */
	async #register(): Promise<void> {
		const claim = (await this.#getWindow?.()) ?? [FULL_WINDOW];
		if (Array.isArray(claim)) await registerWindow(this.#clientId, claim.length > 0 ? claim : [FULL_WINDOW]);
		else await registerTail(this.#clientId, claim.tail);
	}

	async hostConnected(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		await this.#register(); // shared: each span is fetched once, cached for every consumer
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

	/** Re-read the host's claim and re-register it, then re-derive. The host calls this when its claim moves — a tailing view
	 *  widening as the reader nears the top of what it holds, or narrowing back to one page at the live edge; a step detail
	 *  learning its span. Reconcile fetches any new gap and evicts spans no window still wants. */
	async updateWindow(): Promise<void> {
		if (!this.#initialized) return;
		await this.#register();
		this.#onChange();
	}

	/** The events inside this view's claim (deduped, time-sorted). */
	get all(): TEventRecord[] {
		return eventsInWindow(this.#clientId);
	}

	/** Whether the fetch has completed: lets a view show "retrieving" vs "retrieved, and empty" — never a false "no data". */
	get loaded(): boolean {
		return eventsLoaded();
	}

	/** Why what this view asked for could not be fetched, or null — not cached on this device and no server answered. */
	get unavailable(): string | null {
		return eventsUnavailable();
	}

	/** Whether the start of the run is held: a tailing view stops widening there. */
	get atStart(): boolean {
		return atRunStart();
	}

	/** Await this view's claim being loaded — a selector view (step-detail) awaits this before reading `all` on demand. */
	ensureLoaded(): Promise<void> {
		return this.#register();
	}
}
