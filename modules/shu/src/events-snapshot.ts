/**
 * Shared, WINDOWED client cache for the event/log stream — the events analogue of `quads-snapshot.ts`. Every consumer
 * registers what it wants: a span of time (`registerWindow`, e.g. one step's span) or a TAIL counted in events
 * (`registerTail`: the newest N, the way the virtualized views hold a page). The cache holds the reconciled union, fetches
 * only the gaps, evicts what no window still wants — so a long-running tab stays bounded — and persists what it holds in
 * the client's own event store (IndexedDB) together with the spans it knows it holds completely, so a reload, or a tab
 * with no server at all, serves from there first and asks the server only for what it lacks. Hoisted onto a `globalThis`
 * singleton so the separately built component bundles share one store (same reasoning as quads-snapshot's `getStore`).
 */
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import { conduit } from "./hypermedia.js";
import { fetchRange, eventTime } from "./event-backfill.js";
import { mergeRanges, rangeContains, subtractRanges, type Range } from "./ranges.js";
import { GET_EVENTS_METHOD } from "./rpc-cache.js";
import { IndexedDbEventStore, type EventStore } from "./event-store-idb.js";

export type TEventRecord = Record<string, unknown>;
type EventsListener = (events: TEventRecord[]) => void;

/** The whole span — what a consumer that declares no window gets. */
export const FULL_WINDOW: Range = { from: 0, to: Number.POSITIVE_INFINITY };

/** What a reader is told when history is not to hand: not on this device, and no server answered for it. */
export const EVENTS_UNAVAILABLE = "Earlier events are not cached on this device, and the server could not be reached to load them.";

/** The one identity per event — the key every consumer (and `fetchRange`) dedups on. A step's start and end share an
 *  `id`, so the lifecycle `stage` disambiguates; other kinds fall back to `kind`. */
export const eventKey = (e: TEventRecord): string => `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;

type Store = {
	events: TEventRecord[]; // kept sorted by timestamp, deduped — the shared log (the union of held spans)
	seen: Set<string>; // eventKey set backing the dedup
	windows: Map<string, Range[]>; // per-consumer registered windows (a tail is registered as the span its events cover); their union is `wanted`
	wanted: Range[]; // memo of mergeRanges(windows); recomputed at each reconcile
	held: Range[]; // spans actually held (canonical, via mergeRanges)
	persistedHeld: boolean; // the persisted held spans have been read into `held` once
	atStart: boolean; // a page back found no older events: the start of the run is held
	gaps: Map<string, Promise<void>>; // in-flight fetches, deduped by key
	loaded: boolean; // a reconcile has completed at least once
	unavailable: string | null; // why the last fetch could not be satisfied, for the views to say
	listeners: Set<EventsListener>;
	eventStore: EventStore;
};

const STORE_KEY = "__SHU_EVENTS_SNAPSHOT_STORE__";
const CLIENT_SEQ_KEY = "__SHU_EVENTS_CLIENT_SEQ__";

function getStore(): Store {
	const g = globalThis as unknown as Record<string, Store | undefined>;
	const existing = g[STORE_KEY];
	if (existing) return existing;
	const fresh: Store = {
		events: [],
		seen: new Set(),
		windows: new Map(),
		wanted: [],
		held: [],
		persistedHeld: false,
		atStart: false,
		gaps: new Map(),
		loaded: false,
		unavailable: null,
		listeners: new Set(),
		eventStore: new IndexedDbEventStore(),
	};
	g[STORE_KEY] = fresh;
	return fresh;
}

/** Install the event store the log persists to (tests: a memory store). Call before anything registers. */
export function setEventStore(store: EventStore): void {
	getStore().eventStore = store;
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
 *  Returns the events actually admitted. */
function admit(s: Store, batch: TEventRecord[], gate?: Range[]): TEventRecord[] {
	const added: TEventRecord[] = [];
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
		added.push(e);
	}
	return added;
}

/** What the cache holds, persisted: the events (idempotent) and the spans known complete. Fire-and-forget, like the quad
 *  store's writes — persistence never holds up a render, and a context without IndexedDB simply does not persist. */
function persist(s: Store, events: readonly TEventRecord[]): void {
	const store = s.eventStore;
	void store
		.putMany(events)
		.then(() => store.setHeld(s.held))
		.catch((err) => failFastOrLog("[events-snapshot] persist failed:", err));
}

/** Read the persisted held spans once: what this device already holds completely, before anything is fetched. */
async function recallHeld(s: Store): Promise<void> {
	if (s.persistedHeld) return;
	s.persistedHeld = true;
	try {
		s.held = mergeRanges([...s.held, ...(await s.eventStore.held())]);
	} catch (err) {
		failFastOrLog("[events-snapshot] reading persisted spans failed:", err);
	}
}

function fetchGap(s: Store, gap: Range): Promise<void> {
	const key = `${gap.from}:${gap.to}`;
	const inflight = s.gaps.get(key);
	if (inflight) return inflight;
	const p = (async () => {
		// The device's own store first: a span it holds completely needs no server. A span it does not is the server's.
		const fromStore = rangeContains(s.held, gap.from) && rangeContains(s.held, Number.isFinite(gap.to) ? gap.to - 1 : gap.from);
		let fetched: TEventRecord[];
		if (fromStore) fetched = (await s.eventStore.newestBefore(Number.isFinite(gap.to) ? gap.to : undefined, Number.MAX_SAFE_INTEGER)).filter((e) => rangeContains([gap], eventTime(e)));
		else
			fetched = await fetchRange(gap, (window) =>
				conduit().follow<{ events?: TEventRecord[]; truncated?: boolean }>({ method: GET_EVENTS_METHOD, params: { filter: window } }, "events-snapshot: window fetch"),
			);
		const added = admit(s, fetched);
		s.held = mergeRanges([...s.held, gap]);
		if (!fromStore) persist(s, added);
	})();
	s.gaps.set(key, p);
	return p.finally(() => s.gaps.delete(key));
}

/** Fetch the un-held parts of `wanted`, then evict events no window wants. Notifies once settled. */
async function reconcile(s: Store): Promise<void> {
	await recallHeld(s);
	const wanted = wantedOf(s);
	s.wanted = wanted; // memo for the live-merge gate; windows only change through register/unregister, both of which reconcile
	try {
		const gaps = subtractRanges(wanted, s.held);
		await Promise.all(gaps.map((gap) => fetchGap(s, gap)));
		if (gaps.length > 0) s.unavailable = null; // a fetch that succeeded clears the note; a reconcile with nothing to fetch leaves it
	} catch (err) {
		// What was asked for is not on this device and the server did not answer. That is a state the reader is told about
		// (the views render `unavailable`), not a programming error, so it is noted rather than thrown; what IS held still shows.
		s.unavailable = EVENTS_UNAVAILABLE;
		console.warn("[events-snapshot] history unavailable:", err);
	}
	const orphans = subtractRanges(s.held, wanted);
	if (orphans.length > 0) {
		s.events = s.events.filter((e) => !rangeContains(orphans, eventTime(e)));
		s.seen = new Set(s.events.map(eventKey));
		// Evicted from memory only: the device's store keeps them, and `held` keeps saying they are there to read back.
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

/** The newest `limit` events at or before `until` as one page, from the device's store when that span is held there,
 *  else from the server (which pages its own disk log past its buffer). Admitted, held and persisted. Returns the page
 *  and how many of it were new to the log. */
function pageBefore(s: Store, until: number | undefined, limit: number): Promise<{ page: TEventRecord[]; added: number }> {
	const key = `tail:${until ?? "now"}:${limit}`;
	const inflight = s.gaps.get(key);
	if (inflight) return inflight.then(() => ({ page: [], added: 0 }));
	const p = (async (): Promise<{ page: TEventRecord[]; added: number }> => {
		// What the device holds of this page shows whatever else happens: it is real data, admitted first. It is the whole
		// page only when the device holds that span completely; otherwise the server is asked, and what it sends is
		// persisted for next time. A server that cannot be reached leaves the device's part showing and throws, so the
		// caller can say the rest could not be loaded.
		const stored = await s.eventStore.newestBefore(until, limit);
		const storedSpan = stored.length > 0 ? { from: eventTime(stored[0]), to: until ?? eventTime(stored[stored.length - 1]) + 1 } : undefined;
		const complete = stored.length >= limit && storedSpan !== undefined && rangeContains(s.held, storedSpan.from) && rangeContains(s.held, storedSpan.to - 1);
		let added = admit(s, stored);
		let page = stored;
		if (!complete) {
			page =
				(
					await conduit().follow<{ events?: TEventRecord[] }>(
						{ method: GET_EVENTS_METHOD, params: { filter: { ...(until === undefined ? {} : { until }), limit } } },
						"events-snapshot: a page of the newest events",
					)
				).events ?? [];
			added = [...added, ...admit(s, page)];
		}
		if (page.length > 0) {
			const from = eventTime(page[0]);
			const to = until === undefined ? Number.POSITIVE_INFINITY : until + 1;
			s.held = mergeRanges([...s.held, { from, to }]);
		}
		if (!complete) persist(s, added);
		return { page, added: added.length };
	})();
	s.gaps.set(
		key,
		p.then(
			() => undefined,
			() => undefined, // the caller observes the rejection; this entry only dedups concurrent asks
		),
	);
	return p.finally(() => s.gaps.delete(key));
}

/**
 * Register (or replace) a consumer's TAIL: it wants the newest `count` events. Pages back from the newest held event
 * until that many are held or the start of the run is reached, each page from the device's store first, then registers
 * the span those events cover as this consumer's window. A page that reaches past the buffer on the server is served
 * from the server's disk log, so the walk reaches the start of the run. When the count shrinks (the reader is back at
 * the live edge) the window narrows and the reconcile evicts what nothing else wants.
 */
export async function registerTail(clientId: string, count: number): Promise<void> {
	const s = getStore();
	await recallHeld(s);
	try {
		// What is held at the newest end already: from the live edge back to the oldest event held contiguously with it.
		let oldest: number | undefined;
		for (let i = s.events.length - 1; i >= 0 && rangeContains(s.held, eventTime(s.events[i])); i--) oldest = eventTime(s.events[i]);
		let have = oldest === undefined ? 0 : s.events.filter((e) => eventTime(e) >= (oldest as number)).length;
		let until = oldest;
		let limit = count;
		while (have < count && !s.atStart) {
			const { page, added } = await pageBefore(s, until, limit);
			// A page that adds nothing the log did not hold (at most the event at the cursor itself) means the run has nothing
			// older: the start is held, and so is everything before the oldest event — there is nothing there to fetch.
			if (added === 0 || page.length < limit) {
				s.atStart = true;
				if (s.events.length > 0) s.held = mergeRanges([...s.held, { from: 0, to: eventTime(s.events[0]) + 1 }]);
			}
			if (page.length === 0) break;
			const earliest = eventTime(page[0]);
			have = s.events.filter((e) => eventTime(e) >= earliest).length;
			// Many events in one millisecond can fill a page at the cursor's own time: ask for more so the walk moves.
			limit = earliest === until ? limit * 2 : Math.max(1, count - have);
			until = earliest;
		}
		s.unavailable = null;
	} catch (err) {
		s.unavailable = EVENTS_UNAVAILABLE; // told to the reader, not thrown: see reconcile
		console.warn("[events-snapshot] tail unavailable:", err);
	}
	// The span this consumer's count covers: from the count-th newest held event to the live edge, or the whole run when
	// the start is held and the run is shorter than the count.
	const newest = s.events.slice(Math.max(0, s.events.length - count));
	const from = s.atStart && newest.length === s.events.length ? 0 : newest.length > 0 ? eventTime(newest[0]) : 0;
	s.windows.set(clientId, [{ from, to: Number.POSITIVE_INFINITY }]);
	await reconcile(s);
}

/** Drop a consumer's window; the spans no remaining window wants are evicted on the reconcile. */
export async function unregisterWindow(clientId: string): Promise<void> {
	const s = getStore();
	if (!s.windows.delete(clientId)) return;
	await reconcile(s);
}

/** The events inside a consumer's own window — the slice it renders. With the full window this is the whole log. */
export function eventsInWindow(clientId: string): TEventRecord[] {
	const s = getStore();
	const ranges = s.windows.get(clientId);
	if (!ranges) return [];
	const merged = mergeRanges(ranges);
	if (merged.length === 1 && merged[0].from <= 0 && !Number.isFinite(merged[0].to)) return s.events; // full window: no filter pass
	return s.events.filter((e) => rangeContains(merged, eventTime(e)));
}

/** Whether the start of the run is held: paging back found nothing older. */
export function atRunStart(): boolean {
	return getStore().atStart;
}

/** Why the last fetch could not be satisfied, or null: what a view says instead of a false "no events". */
export function eventsUnavailable(): string | null {
	return getStore().unavailable;
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
 *  edge is not retained), deduped + time-sorted, and persisted. Notifies subscribers iff at least one event was new. */
export function mergeEvents(batch: TEventRecord[]): void {
	const s = getStore();
	const added = admit(s, batch, s.wanted.length > 0 ? s.wanted : undefined); // memoized gate — no per-batch mergeRanges over the windows
	if (added.length === 0) return;
	// Live events extend what is held to the live edge: everything from the oldest admitted to now is complete.
	const from = eventTime(added[0]);
	s.held = mergeRanges([...s.held, { from, to: Number.POSITIVE_INFINITY }]);
	persist(s, added);
	notify(s);
}

/** Test-only: drop the singleton so the next test starts with an empty log. */
export function resetEventsSnapshot(): void {
	delete (globalThis as unknown as Record<string, Store | undefined>)[STORE_KEY];
}
