import type { ReactiveController, ReactiveControllerHost } from "lit";
import { registerWindow, registerTail, unregisterWindow, eventsInWindow, eventsLoaded, eventsUnavailable, claimReachesStart, mergeEvents, subscribeEvents, newWindowClientId, FULL_WINDOW, type TEventRecord } from "../events-snapshot.js";
import type { Range } from "../ranges.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";

/** A view's claim on the shared log: spans of time (one step's span), or a TAIL counted in events — the newest `tail` at
 *  the levels the view shows (`minLevel` and up), the way a virtualized view holds a page. Default (no hook, or a hook
 *  answering none) = the full span. */
export type TEventWindow = Range[] | { tail: number; minLevel?: THaibunLogLevel };
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
	#unsubscribeLog?: () => void;
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
		else await registerTail(this.#clientId, claim.tail, claim.minLevel);
	}

	async hostConnected(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		// Every change to the shared log re-derives this view: a page of its own tail landing, a sibling view's fetch, a live
		// merge, an eviction. One path, the log's own notification, whoever caused the change — so a view is never blank
		// while its tail is still being paged in, and never stale for a change another view brought about.
		this.#unsubscribeLog = subscribeEvents(() => this.#onChange());
		await this.#register(); // shared: each span is fetched once, cached for every consumer
		this.#onChange();
		if (this.#host.hasAttribute("data-snapshot-time")) return; // snapshot mode: one fetch, no live updates
		this.#teardown = subscribeBatchedEvents({
			onBatch: (events) => mergeEvents(events), // into the shared log (deduped, gated to the claims); its notification re-derives every view
		});
	}

	hostDisconnected(): void {
		this.#teardown?.();
		this.#teardown = undefined;
		this.#unsubscribeLog?.();
		this.#unsubscribeLog = undefined;
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

	/** Whether this view's claim reaches the start of the run: a tailing view stops widening there, and starts again once
	 *  it has narrowed back to its newest page. */
	get atStart(): boolean {
		return claimReachesStart(this.#clientId);
	}

	/** Await this view's claim being loaded — a selector view (step-detail) awaits this before reading `all` on demand. */
	ensureLoaded(): Promise<void> {
		return this.#register();
	}
}
