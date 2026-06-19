/**
 * Shared client cache for the event/log stream — the events analog of `quads-snapshot.ts`. Every event/log consumer
 * (monitor, document, step-detail) reads from this ONE store instead of each running its own `fetchAllEvents` backfill
 * plus a private array and dedup, so the views can't drift and the full history is paged from the server only once.
 * Backfill on first use (paged, byte-bounded `getEvents` via `fetchAllEvents`), live SSE batches merged in under one
 * dedup, subscribers fanned out. Hoisted onto a `globalThis` singleton so the separately-built component bundles share
 * one store (same reasoning as quads-snapshot's `getStore`).
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "./hypermedia.js";
import { fetchAllEvents } from "./event-backfill.js";
import { GET_EVENTS_METHOD } from "./rpc-cache.js";

export type TEventRecord = Record<string, unknown>;
type EventsListener = (events: TEventRecord[]) => void;

/** The one identity per event — the key every consumer (and `fetchAllEvents`) dedups on. A step's start and end share an
 *  `id`, so the lifecycle `stage` disambiguates; other kinds fall back to `kind`. */
export const eventKey = (e: TEventRecord): string => `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;

type Store = {
	events: TEventRecord[]; // append-ordered, deduped — the single shared log
	seen: Set<string>; // eventKey set backing the dedup
	pending: Promise<TEventRecord[]> | null; // in-flight backfill, shared by concurrent callers
	loaded: boolean; // a full backfill has completed at least once
	listeners: Set<EventsListener>;
};

const STORE_KEY = "__SHU_EVENTS_SNAPSHOT_STORE__";

function getStore(): Store {
	const g = globalThis as unknown as Record<string, Store | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const fresh: Store = { events: [], seen: new Set(), pending: null, loaded: false, listeners: new Set() };
	g[STORE_KEY] = fresh;
	return fresh;
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

/** Subscribe to the shared event log. Fires after the backfill and after each live merge that admits something new,
 *  with the full deduped append-ordered list. Returns an unsubscribe — call from disconnectedCallback. */
export function subscribeEvents(listener: EventsListener): () => void {
	const s = getStore();
	s.listeners.add(listener);
	return () => s.listeners.delete(listener);
}

/** The current deduped event log, read synchronously (no fetch). Empty before the first backfill. */
export function currentEvents(): TEventRecord[] {
	return getStore().events;
}

/** Merge a batch (a live SSE batch or a backfill page) into the shared log, deduped by `eventKey`, preserving arrival
 *  order. Notifies subscribers iff at least one event was new. */
export function mergeEvents(batch: TEventRecord[]): void {
	const s = getStore();
	let added = 0;
	for (const e of batch) {
		const key = eventKey(e);
		if (s.seen.has(key)) continue;
		s.seen.add(key);
		s.events.push(e);
		added++;
	}
	if (added > 0) notify(s);
}

/** Backfill the full historical event log once (paged, byte-bounded `getEvents`), caching it. Concurrent callers share
 *  one in-flight fetch; once loaded, callers get the cached log with no RPC. `forceRefresh` re-pages from scratch. */
export async function getEventSnapshot(opts: { forceRefresh?: boolean } = {}): Promise<TEventRecord[]> {
	const s = getStore();
	if (opts.forceRefresh) {
		s.events = [];
		s.seen = new Set();
		s.loaded = false;
		s.pending = null;
	}
	if (s.loaded) return s.events;
	if (s.pending) return s.pending;
	s.pending = (async () => {
		const events = await fetchAllEvents((window) =>
			conduit().follow<{ events?: TEventRecord[]; truncated?: boolean }>({ method: GET_EVENTS_METHOD, params: { filter: window } }, "events-snapshot: backfill"),
		);
		mergeEvents(events); // dedup + notify
		s.loaded = true;
		return s.events;
	})();
	try {
		return await s.pending;
	} finally {
		s.pending = null;
	}
}

/** Test-only: drop the singleton so the next test starts with an empty log. */
export function resetEventsSnapshot(): void {
	delete (globalThis as unknown as Record<string, Store | undefined>)[STORE_KEY];
}
