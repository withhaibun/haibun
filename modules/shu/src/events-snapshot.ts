/**
 * Shared, RANGE-WINDOWED client cache for the event/log stream — the events analog of `quads-snapshot.ts`. Every consumer
 * registers the time window it wants (its visible extent + a prefetch margin); the cache holds the reconciled UNION of all
 * registered windows, fetches only the gaps (`fetchRange`), and evicts spans no window still wants — so a long-running tab
 * stays bounded instead of retaining the whole history forever. Hoisted onto a `globalThis` singleton so the separately
 * built component bundles share one store (same reasoning as quads-snapshot's `getStore`).
 *
 * Transitional default (this phase): a consumer that hasn't declared a real window registers the FULL span, so `wanted`
 * covers everything — the gap is the whole history (one backfill) and nothing is ever an orphan (no eviction). Behaviour
 * is therefore identical to the previous backfill-everything cache until a consumer opts into a bounded window.
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "./hypermedia.js";
import { fetchRange, eventTime } from "./event-backfill.js";
import { mergeRanges, rangeContains, subtractRanges, type Range } from "./ranges.js";
import { GET_EVENTS_METHOD } from "./rpc-cache.js";

export type TEventRecord = Record<string, unknown>;
type EventsListener = (events: TEventRecord[]) => void;

/** The whole span — the transitional full-window default (see the file header). */
export const FULL_WINDOW: Range = { from: 0, to: Number.POSITIVE_INFINITY };

/** The one identity per event — the key every consumer (and `fetchRange`) dedups on. A step's start and end share an
 *  `id`, so the lifecycle `stage` disambiguates; other kinds fall back to `kind`. */
export const eventKey = (e: TEventRecord): string => `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;

type Store = {
	events: TEventRecord[]; // kept sorted by timestamp, deduped — the shared log (the union of held spans)
	seen: Set<string>; // eventKey set backing the dedup
	windows: Map<string, Range[]>; // per-consumer registered windows; their union is `wanted`
	wanted: Range[]; // memo of mergeRanges(windows); recomputed only at each reconcile (the sole window-mutation settle point)
	held: Range[]; // spans actually fetched into memory (canonical, via mergeRanges)
	gaps: Map<string, Promise<void>>; // in-flight gap fetches, deduped by range key
	loaded: boolean; // a reconcile has completed at least once
	listeners: Set<EventsListener>;
};

const STORE_KEY = "__SHU_EVENTS_SNAPSHOT_STORE__";
const CLIENT_SEQ_KEY = "__SHU_EVENTS_CLIENT_SEQ__";

function getStore(): Store {
	const g = globalThis as unknown as Record<string, Store | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const fresh: Store = { events: [], seen: new Set(), windows: new Map(), wanted: [], held: [], gaps: new Map(), loaded: false, listeners: new Set() };
	g[STORE_KEY] = fresh;
	return fresh;
}

/** A process-wide unique window id (a globalThis counter so ids don't collide across the separately built bundles). */
export function newWindowClientId(): string {
	const g = globalThis as unknown as Record<string, number | undefined>;
	g[CLIENT_SEQ_KEY] = (g[CLIENT_SEQ_KEY] ?? 0) + 1;
	return `ec-${g[CLIENT_SEQ_KEY]}`;
}

function notify(s: Store): void {
	for (const fn of s.listeners) {
		try {
			fn(s.events);
		} catch (err) {
			failFastOrLog("[events-snapshot] listener failed:", err);
		}
	}
}

const wantedOf = (s: Store): Range[] => mergeRanges([...s.windows.values()].flat());

/** Dedup + sorted (by timestamp) insert of a batch; drops quad-observation artifacts (graph data, not log events). When a
 *  `gate` is given, keeps only events whose time falls in it (live-edge routing — an event past every window is dropped).
 *  Returns the count actually admitted. */
function admit(s: Store, batch: TEventRecord[], gate?: Range[]): number {
	let added = 0;
	for (const e of batch) {
		if (e.kind === "artifact" && (e.json as { quadObservation?: unknown } | undefined)?.quadObservation !== undefined) continue;
		if (gate && !rangeContains(gate, eventTime(e))) continue;
		const key = eventKey(e);
		if (s.seen.has(key)) continue;
		s.seen.add(key);
		const t = eventTime(e);
		// Sorted insert; the common live-tail case (newest event) is a cheap push.
		if (s.events.length === 0 || eventTime(s.events[s.events.length - 1]) <= t) s.events.push(e);
		else {
			let lo = 0;
			let hi = s.events.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (eventTime(s.events[mid]) <= t) lo = mid + 1;
				else hi = mid;
			}
			s.events.splice(lo, 0, e);
		}
		added++;
	}
	return added;
}

function fetchGap(s: Store, gap: Range): Promise<void> {
	const key = `${gap.from}:${gap.to}`;
	const inflight = s.gaps.get(key);
	if (inflight) return inflight;
	const p = (async () => {
		const fetched = await fetchRange(gap, (window) =>
			conduit().follow<{ events?: TEventRecord[]; truncated?: boolean }>({ method: GET_EVENTS_METHOD, params: { filter: window } }, "events-snapshot: window fetch"),
		);
		admit(s, fetched);
		s.held = mergeRanges([...s.held, gap]);
	})();
	s.gaps.set(key, p);
	return p.finally(() => s.gaps.delete(key));
}

/** Fetch the un-held parts of `wanted`, then evict events no window wants. Notifies once settled. */
async function reconcile(s: Store): Promise<void> {
	const wanted = wantedOf(s);
	s.wanted = wanted; // memo for the live-merge gate; windows only change through register/unregister, both of which reconcile
	await Promise.all(subtractRanges(wanted, s.held).map((gap) => fetchGap(s, gap)));
	const orphans = subtractRanges(s.held, wanted);
	if (orphans.length > 0) {
		s.events = s.events.filter((e) => !rangeContains(orphans, eventTime(e)));
		s.seen = new Set(s.events.map(eventKey));
		s.held = subtractRanges(s.held, orphans);
	}
	s.loaded = true;
	notify(s);
}

/** Register (or replace) a consumer's window(s), then reconcile so the cache holds the union of all registered windows. */
export async function registerWindow(clientId: string, ranges: Range[]): Promise<void> {
	const s = getStore();
	s.windows.set(clientId, ranges);
	await reconcile(s);
}

/** Drop a consumer's window; the spans no remaining window wants are evicted on the reconcile. */
export async function unregisterWindow(clientId: string): Promise<void> {
	const s = getStore();
	if (!s.windows.delete(clientId)) return;
	await reconcile(s);
}

/** The events inside a consumer's own window — the slice it renders. With the full-window default this is the whole log. */
export function eventsInWindow(clientId: string): TEventRecord[] {
	const s = getStore();
	const ranges = s.windows.get(clientId);
	if (!ranges) return [];
	const merged = mergeRanges(ranges);
	if (merged.length === 1 && merged[0].from <= 0 && !Number.isFinite(merged[0].to)) return s.events; // full window: no filter pass
	return s.events.filter((e) => rangeContains(merged, eventTime(e)));
}

/** Subscribe to the shared event log. Fires after each reconcile / live merge that admits something new, with the full
 *  deduped list. Returns an unsubscribe — call from disconnectedCallback. */
export function subscribeEvents(listener: EventsListener): () => void {
	const s = getStore();
	s.listeners.add(listener);
	return () => s.listeners.delete(listener);
}

/** The current deduped, time-sorted event log, read synchronously (no fetch). */
export function currentEvents(): TEventRecord[] {
	return getStore().events;
}

/**
 * When the run this page holds starts and ends, read without asking for anything.
 *
 * The log is kept time-sorted, so this is its two ends rather than a scan. It registers NO window: a reader that only
 * wants to say where the cursor sits in the run must not thereby ask for the whole history, which would both page the
 * entire run in at boot and pin it in memory — a window nobody can evict past, since eviction keeps whatever any
 * consumer still wants. Both ends are 0 before anything has happened.
 */
export function runSpan(): { first: number; last: number } {
	const events = getStore().events;
	return events.length === 0 ? { first: 0, last: 0 } : { first: eventTime(events[0]), last: eventTime(events[events.length - 1]) };
}

/** Whether a reconcile has completed — lets a consumer tell "retrieved, and empty" from "still retrieving". */
export function eventsLoaded(): boolean {
	return getStore().loaded;
}

/** Merge a live SSE batch into the shared log, gated to the union of registered windows (an event past every window's
 *  edge is not retained), deduped + time-sorted. Notifies subscribers iff at least one event was new. */
export function mergeEvents(batch: TEventRecord[]): void {
	const s = getStore();
	const added = admit(s, batch, s.wanted.length > 0 ? s.wanted : undefined); // memoized gate — no per-batch mergeRanges over the windows
	if (added > 0) notify(s);
}

/** Backfill the full history once — a full-window registration under a shared key. Direct callers (e.g. step-detail's
 *  on-demand read) use this; the controller registers its own window. `forceRefresh` re-pages from scratch. */
export async function getEventSnapshot(opts: { forceRefresh?: boolean } = {}): Promise<TEventRecord[]> {
	const s = getStore();
	if (opts.forceRefresh) {
		s.events = [];
		s.seen = new Set();
		s.held = [];
		s.loaded = false;
		s.gaps.clear();
	}
	await registerWindow("__full__", [FULL_WINDOW]);
	return s.events;
}

/** Test-only: drop the singleton so the next test starts with an empty log. */
export function resetEventsSnapshot(): void {
	delete (globalThis as unknown as Record<string, Store | undefined>)[STORE_KEY];
}
