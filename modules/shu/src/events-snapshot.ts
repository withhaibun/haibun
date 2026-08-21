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
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";

/** The levels at or above `minLevel`: the rule every log view filters by, and so the rule every claim on the log states. */
export function levelsFrom(minLevel: THaibunLogLevel | undefined): readonly string[] | undefined {
	if (!minLevel) return undefined;
	return HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel));
}

/** A consumer's claim: spans of time, and the levels it shows (all, when unstated). An event is wanted by a claim when its
 *  time is in a span and its level is one shown. */
export type TClaim = { ranges: Range[]; levels?: readonly string[] };
const claimWants = (c: TClaim, e: TEventRecord): boolean => rangeContains(c.ranges, eventTime(e)) && (!c.levels || c.levels.includes(String(e.level)));

export type TEventRecord = Record<string, unknown>;
type EventsListener = (events: TEventRecord[]) => void;

/** The whole span — what a consumer that declares no window gets. */
export const FULL_WINDOW: Range = { from: 0, to: Number.POSITIVE_INFINITY };

/** The most events one page of a tail asks for: a walk to the start of a long run is many pages, never one answer of it. */
const TAIL_PAGE_MAX = 2000;

/** What a reader is told when history is not to hand: not on this device, and no server answered for it. */
export const EVENTS_UNAVAILABLE = "Earlier events are not cached on this device, and the server could not be reached to load them.";

/** The one identity per event — the key every consumer (and `fetchRange`) dedups on. A step's start and end share an
 *  `id`, so the lifecycle `stage` disambiguates; other kinds fall back to `kind`. */
export const eventKey = (e: TEventRecord): string => `${e.id}:${(e.stage as string | undefined) ?? (e.kind as string | undefined) ?? ""}`;

type TPage = { page: TEventRecord[]; added: number; truncated: boolean };
type Store = {
	events: TEventRecord[]; // kept sorted by timestamp, deduped — the shared log (the union of held spans)
	seen: Set<string>; // eventKey set backing the dedup
	windows: Map<string, TClaim>; // per-consumer claims (a tail is registered as the span its events cover, at its levels)
	wanted: Range[]; // memo of the union of claimed spans; recomputed at each reconcile (the gate for what is fetched and held)
	held: Range[]; // spans actually held (canonical, via mergeRanges)
	persistedHeld: boolean; // the persisted held spans have been read into `held` once
	runStart: number | undefined; // when the run's first event happened, once known: a walk back that holds it holds the start
	gaps: Map<string, Promise<void>>; // in-flight span fetches, deduped by key
	pages: Map<string, Promise<TPage>>; // in-flight page fetches, deduped by key: concurrent askers share the one page
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
		runStart: undefined,
		gaps: new Map(),
		pages: new Map(),
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

const wantedOf = (s: Store): Range[] => mergeRanges([...s.windows.values()].flatMap((c) => c.ranges));
/** Whether any consumer's claim wants this event: in one of its spans, at one of its levels. */
const anyClaimWants = (s: Store, e: TEventRecord): boolean => [...s.windows.values()].some((c) => claimWants(c, e));

/** Dedup + sorted (by timestamp) insert of a batch; drops quad-observation artifacts (graph data, not log events). When
 *  `gated`, keeps only events some claim wants (live-edge routing — an event past every span, or at a level no view shows,
 *  is not retained). Returns the events actually admitted. */
function admit(s: Store, batch: TEventRecord[], gated = false): TEventRecord[] {
	const added: TEventRecord[] = [];
	for (const e of batch) {
		if (e.kind === "artifact" && (e.json as { quadObservation?: unknown } | undefined)?.quadObservation !== undefined) continue;
		if (gated && !anyClaimWants(s, e)) continue;
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

/** An event as the device keeps it: what the run's report keeps of it. Inline artifact content (an image's bytes) and
 *  the step's value map are the bulk of a live event and are never read back from the store — the artifact is fetched
 *  by its path, the values by the step — so they are not written to it; products keep only their display fields. A
 *  store of raw live events was read at a hundred milliseconds a row, and a page of five hundred never returned. */
export function leanForStore(e: TEventRecord): TEventRecord {
	const { content: _content, stepValuesMap: _values, ...rest } = e as TEventRecord & { content?: unknown; stepValuesMap?: unknown };
	const products = rest.products as Record<string, unknown> | undefined;
	if (products && typeof products === "object") {
		const kept: Record<string, unknown> = {};
		for (const f of ["view", "_component", "_type", "_summary"]) if (products[f] !== undefined) kept[f] = products[f];
		rest.products = Object.keys(kept).length > 0 ? kept : undefined;
	}
	return rest;
}

/** What the cache holds, persisted: the events (lean, idempotent) and the spans known complete. Fire-and-forget, like the
 *  quad store's writes — persistence never holds up a render, and a context without IndexedDB simply does not persist. */
function persist(s: Store, events: readonly TEventRecord[]): void {
	const store = s.eventStore;
	void store
		.putMany(events.map(leanForStore))
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
	// Evict what no claim wants: outside every span, or inside one but at a level no view there shows. From memory only:
	// the device's store keeps them, and `held` keeps saying they are there to read back.
	if (s.windows.size > 0) {
		const kept = s.events.filter((e) => anyClaimWants(s, e));
		if (kept.length !== s.events.length) {
			s.events = kept;
			s.seen = new Set(kept.map(eventKey));
		}
	}
	s.loaded = true;
	notify(s);
}

/** Register (or replace) a consumer's claim on spans of time (all levels), then reconcile so the cache holds the union. */
export async function registerWindow(clientId: string, ranges: Range[]): Promise<void> {
	const s = getStore();
	s.windows.set(clientId, { ranges });
	await reconcile(s);
}

/** The newest `limit` events at or before `until` as one page, from the device's store when that span is held there,
 *  else from the server (which pages its own disk log past its buffer). Admitted, held and persisted. Returns the page
 *  and how many of it were new to the log. */
function pageBefore(s: Store, until: number | undefined, limit: number, minLevel: THaibunLogLevel | undefined): Promise<TPage> {
	const key = `${until ?? "now"}:${limit}:${minLevel ?? ""}`;
	const inflight = s.pages.get(key);
	if (inflight) return inflight; // two views asking for the same page at once (boot) share the one answer, page and all
	const p = (async (): Promise<TPage> => {
		let truncated = false;
		// What the device holds of this page shows whatever else happens: it is real data, admitted first. It is the whole
		// page only when the device holds that span completely; otherwise the server is asked, and what it sends is
		// persisted for next time. A server that cannot be reached leaves the device's part showing and throws, so the
		// caller can say the rest could not be loaded.
		const stored = await s.eventStore.newestBefore(until, limit, levelsFrom(minLevel));
		const storedSpan = stored.length > 0 ? { from: eventTime(stored[0]), to: until ?? eventTime(stored[stored.length - 1]) + 1 } : undefined;
		const complete = stored.length >= limit && storedSpan !== undefined && rangeContains(s.held, storedSpan.from) && rangeContains(s.held, storedSpan.to - 1);
		const levels = levelsFrom(minLevel);
		const atLevels = (events: TEventRecord[]): TEventRecord[] => (levels ? events.filter((e) => levels.includes(String(e.level))) : events);
		let added = admit(s, atLevels(stored));
		let page = stored;
		if (!complete) {
			const answer = await conduit().follow<{ events?: TEventRecord[]; truncated?: boolean; first?: number }>(
				{ method: GET_EVENTS_METHOD, params: { filter: { ...(until === undefined ? {} : { until }), ...(minLevel ? { minLevel } : {}), limit } } },
				"events-snapshot: a page of the newest events",
			);
			page = answer.events ?? [];
			truncated = answer.truncated === true; // the server says whether older events exist past this page
			if (typeof answer.first === "number") s.runStart = answer.first; // and when the run began, so a walk knows when it holds the start
			// Only the levels asked for are kept: a server answering at every level (one that predates `minLevel`) must
			// not fill the tab with what the asking view does not show.
			added = [...added, ...admit(s, atLevels(page))];
		}
		if (page.length > 0) {
			const from = eventTime(page[0]);
			const to = until === undefined ? Number.POSITIVE_INFINITY : until + 1;
			s.held = mergeRanges([...s.held, { from, to }]);
		}
		if (!complete) persist(s, added);
		return { page, added: added.length, truncated };
	})();
	s.pages.set(key, p);
	p.catch(() => undefined); // every caller observes the rejection through its own await; this only keeps it from being unhandled
	return p.finally(() => s.pages.delete(key));
}

/**
 * Register (or replace) a consumer's TAIL: it wants the newest `count` events at the levels it shows (`minLevel` and
 * up; all levels when unstated). Pages back from the newest held event at those levels until that many are held or the
 * start of the run is reached, each page from the device's store first, then registers the span those events cover, at
 * those levels, as this consumer's claim. A page that reaches past the buffer on the server is served from the server's
 * disk log, so the walk reaches the start of the run. When the count shrinks (the reader is back at the live edge) the
 * claim narrows and the reconcile evicts what nothing else wants.
 */
export async function registerTail(clientId: string, count: number, minLevel?: THaibunLogLevel): Promise<void> {
	const s = getStore();
	await recallHeld(s);
	const levels = levelsFrom(minLevel);
	const shown = (e: TEventRecord): boolean => !levels || levels.includes(String(e.level));
	// Whether what is held in memory at these levels reaches the run's start: its oldest held event is the run's first
	// (known from the server, or from a walk that ran out of older events). Held in memory, not once-known: a view that
	// narrowed back to its newest page no longer holds the start, and must be able to page back to it again.
	let reachedStart = false;
	const holdsStart = (): boolean => {
		if (reachedStart) return true;
		const oldestHeld = s.events.find(shown);
		return s.runStart !== undefined && oldestHeld !== undefined && eventTime(oldestHeld) <= s.runStart;
	};
	// The claim this consumer holds as of now: from the count-th newest held event at its levels to the live edge, or
	// the whole run when the start is held and the run holds fewer. Set before the first page and after every page, so
	// the view renders what is held while the rest of its tail is still being paged in.
	const claim = (): void => {
		const mine = s.events.filter(shown);
		const newest = mine.slice(Math.max(0, mine.length - count));
		// Nothing held yet and the start not reached (mid-walk): a claim on nothing, so no reconcile fetches the whole run
		// for it. The start held with nothing at these levels: a claim on everything to come, so live events are kept.
		const from = holdsStart() && newest.length === mine.length ? 0 : newest.length > 0 ? eventTime(newest[0]) : undefined;
		s.windows.set(clientId, { ranges: from === undefined ? [] : [{ from, to: Number.POSITIVE_INFINITY }], levels });
	};
	claim();
	try {
		// What is held at the newest end already: from the live edge back to the oldest event held contiguously with it.
		let oldest: number | undefined;
		for (let i = s.events.length - 1; i >= 0 && rangeContains(s.held, eventTime(s.events[i])); i--) oldest = eventTime(s.events[i]);
		let have = oldest === undefined ? 0 : s.events.filter((e) => eventTime(e) >= (oldest as number) && shown(e)).length;
		let until = oldest;
		// The cursor is inclusive: a page asked for at `until` brings the event at `until` back too, so one more is asked for.
		// A walk to the start of a long run asks a page at a time, never the whole run in one answer.
		let limit = Math.min(TAIL_PAGE_MAX, count - have + (until === undefined ? 0 : 1));
		while (have < count && !holdsStart()) {
			const { page, truncated } = await pageBefore(s, until, limit, minLevel);
			// The start of the run is held when a page comes back short AND the server says nothing older exists: a short
			// page the server marks truncated is a buffer's edge, not the run's. Then everything before the oldest event is
			// held too — there is nothing there to fetch.
			if (page.length < limit && !truncated) {
				reachedStart = true;
				if (s.events.length > 0) {
					s.runStart = eventTime(s.events[0]);
					s.held = mergeRanges([...s.held, { from: 0, to: eventTime(s.events[0]) + 1 }]);
				}
			}
			if (page.length === 0) break;
			claim();
			notify(s); // each page shows as it lands: a view is not blank while the rest of its tail is still being paged
			const earliest = eventTime(page[0]);
			have = s.events.filter((e) => eventTime(e) >= earliest && shown(e)).length;
			// Many events in one millisecond can fill a page at the cursor's own time: ask for more so the walk moves.
			limit = Math.min(TAIL_PAGE_MAX, earliest === until ? limit * 2 : Math.max(1, count - have) + 1);
			until = earliest;
		}
		s.unavailable = null;
	} catch (err) {
		s.unavailable = EVENTS_UNAVAILABLE; // told to the reader, not thrown: see reconcile
		console.warn("[events-snapshot] tail unavailable:", err);
	}
	claim();
	await reconcile(s);
}

/** Drop a consumer's window; the spans no remaining window wants are evicted on the reconcile. */
export async function unregisterWindow(clientId: string): Promise<void> {
	const s = getStore();
	if (!s.windows.delete(clientId)) return;
	await reconcile(s);
}

/** The events inside a consumer's own claim — the slice it renders. With the full window at all levels this is the whole log. */
export function eventsInWindow(clientId: string): TEventRecord[] {
	const s = getStore();
	const claim = s.windows.get(clientId);
	if (!claim) return [];
	const merged = mergeRanges(claim.ranges);
	if (!claim.levels && merged.length === 1 && merged[0].from <= 0 && !Number.isFinite(merged[0].to)) return s.events; // full window: no filter pass
	const whole = { ranges: merged, levels: claim.levels };
	return s.events.filter((e) => claimWants(whole, e));
}

/** Whether a consumer's claim reaches the start of the run: it holds everything at its levels from the first event on. A
 *  view that narrowed back to its newest page does not, and can page back to it again. */
export function claimReachesStart(clientId: string): boolean {
	const claim = getStore().windows.get(clientId);
	return !!claim && claim.ranges.length > 0 && claim.ranges[0].from === 0;
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

/** Merge a live SSE batch into the shared log: kept only where some view's claim wants it (in a span it holds, at a level
 *  it shows), so a page with no event view open retains nothing of the stream, and a page with one retains only what it
 *  shows; deduped, time-sorted, persisted. Notifies subscribers iff at least one event was new. */
export function mergeEvents(batch: TEventRecord[]): void {
	const s = getStore();
	const added = admit(s, batch, true);
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
