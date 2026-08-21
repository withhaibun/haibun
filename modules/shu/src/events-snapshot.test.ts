// @vitest-environment jsdom
// The shared event log: one backfill paged from the byte-bounded getEvents, one dedup, fanned out to every consumer —
// the events analog of quads-snapshot. These pin the contract the monitor/document/step-detail/sequence views rely on.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerTail, registerWindow, eventsInWindow, claimReachesStart, eventsUnavailable, EVENTS_UNAVAILABLE, setEventStore, leanForStore, currentEvents, mergeEvents, subscribeEvents, eventKey, resetEventsSnapshot, type TEventRecord } from "./events-snapshot.js";
import { MemoryEventStore } from "./event-store-idb.js";
import { setupShuTest, type TShuTestHandle } from "./test-setup.js";

const ev = (i: number, over: TEventRecord = {}): TEventRecord => ({ id: `0.${i}`, timestamp: i, kind: "log", message: `e${i}`, ...over });

/** Simulate the server's byte/count-bounded getEvents: the newest `cap` events with timestamp <= until, truncated if older remain. */
function windowed(all: TEventRecord[], filter: { until?: number; limit?: number }, cap: number): { events: TEventRecord[]; truncated: boolean } {
	const matching = all.filter((e) => filter.until === undefined || (e.timestamp as number) <= filter.until);
	const events = matching.slice(Math.max(0, matching.length - cap));
	return { events, truncated: events.length < matching.length };
}

describe("events-snapshot shared cache", () => {
	// A live batch is kept only where some view's claim wants it, so these register a view over the whole run first.
	let outer: TShuTestHandle;
	beforeEach(async () => {
		resetEventsSnapshot();
		setEventStore(new MemoryEventStore());
		outer = setupShuTest({ dispatch: () => ({ events: [], truncated: false }) }); // the claim's span has nothing to fetch
		await registerWindow("a-view", [{ from: 0, to: Number.POSITIVE_INFINITY }]);
	});
	afterEach(() => outer?.teardown());

	it("retains nothing of the live stream while no view has a claim, so a page with no event view open holds no log", () => {
		resetEventsSnapshot();
		mergeEvents([ev(1), ev(2)]);
		expect(currentEvents()).toEqual([]);
	});

	it("eventKey disambiguates a step's start and end (shared id, different stage)", () => {
		expect(eventKey({ id: "0.1", kind: "lifecycle", stage: "start" })).not.toBe(eventKey({ id: "0.1", kind: "lifecycle", stage: "end" }));
	});

	it("mergeEvents dedups by eventKey, preserving arrival order", () => {
		mergeEvents([ev(1), ev(2)]);
		mergeEvents([ev(2), ev(3)]); // ev(2) is a duplicate
		expect(currentEvents().map((e) => e.id)).toEqual(["0.1", "0.2", "0.3"]);
	});

	it("drops quad-observations — they are graph data (quads-snapshot), not log events", () => {
		const quadObs = ev(2, { kind: "artifact", artifactType: "json", json: { quadObservation: { subject: "s", predicate: "p", object: "o", namedGraph: "g" } } });
		mergeEvents([ev(1), quadObs, ev(3)]);
		expect(currentEvents().map((e) => e.id)).toEqual(["0.1", "0.3"]); // the quad-observation event is not retained in the log
	});

	it("subscribeEvents fires only when something new is admitted, and stops after unsubscribe", () => {
		let fires = 0;
		const unsub = subscribeEvents(() => {
			fires++;
		});
		mergeEvents([ev(1)]); // +1
		mergeEvents([ev(1)]); // all-dup → no fire
		mergeEvents([ev(2)]); // +1
		unsub();
		mergeEvents([ev(3)]); // unsubscribed → no fire
		expect(fires).toBe(2);
	});

	it("registers the store under a globalThis key (cross-bundle singleton)", () => {
		mergeEvents([ev(1)]);
		expect((globalThis as Record<string, unknown>).__SHU_EVENTS_SNAPSHOT_STORE__).toBeDefined();
	});

	describe("a tail, paged back from the newest event", () => {
		// A tailing view asks for the newest N: the log pages back from the live edge by `until`, a page at a time, each page
		// from the device's own store when it holds that span completely and from the server otherwise, until N are held or
		// the start of the run is reached; and it persists what it fetched, with the spans it now holds, for the next time.
		let handle: TShuTestHandle;
		let calls: Array<{ until?: number; limit?: number }>;
		let store: MemoryEventStore;
		const ALL = [ev(1), ev(2), ev(3), ev(4)];
		beforeEach(() => {
			resetEventsSnapshot(); // these register their own claims
			calls = [];
			store = new MemoryEventStore();
			setEventStore(store);
			handle = setupShuTest({
				dispatch: (method, params) => {
					if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
					const filter = (params as { filter: { until?: number; limit?: number } }).filter;
					calls.push(filter);
					return windowed(ALL, filter, filter.limit ?? 100);
				},
			});
		});
		afterEach(() => handle.teardown());

		it("holds the newest N, paging back by `until` from the server, oldest-first", async () => {
			await registerTail("view", 3);
			expect(eventsInWindow("view").map((e) => e.id), "the newest three").toEqual(["0.2", "0.3", "0.4"]);
			expect(calls[0], "the first page is the newest N").toEqual({ limit: 3 });
		});

		it("reaches the start of the run and says so, so nothing widens past it", async () => {
			await registerTail("view", 10);
			expect(eventsInWindow("view").map((e) => e.id)).toEqual(["0.1", "0.2", "0.3", "0.4"]);
			expect(claimReachesStart("view")).toBe(true);
		});

		it("a view that reached the start, then narrowed back to its newest page, can page back to the start again", async () => {
			// Scrolling to the live edge narrows a view to one page and evicts the rest; scrolling up again must page back.
			await registerTail("view", 10);
			expect(claimReachesStart("view")).toBe(true);
			await registerTail("view", 2); // back at the live edge: the newest two
			expect(eventsInWindow("view").map((e) => e.id)).toEqual(["0.3", "0.4"]);
			expect(claimReachesStart("view"), "no longer holds the start").toBe(false);
			await registerTail("view", 10); // scrolling up again
			expect(eventsInWindow("view").map((e) => e.id), "back to the start").toEqual(["0.1", "0.2", "0.3", "0.4"]);
			expect(claimReachesStart("view")).toBe(true);
		});

		it("a second consumer's tail is served from what is held: no second fetch", async () => {
			await registerTail("a", 10);
			const after = calls.length;
			await registerTail("b", 10);
			expect(calls.length).toBe(after);
			expect(eventsInWindow("b").map((e) => e.id)).toEqual(["0.1", "0.2", "0.3", "0.4"]);
		});

		it("persists what it fetched and the spans it holds, so the next time it serves from the device", async () => {
			await registerTail("view", 10);
			await new Promise((r) => setTimeout(r, 0)); // persistence is fire-and-forget
			expect(store.size, "every fetched event is on the device").toBe(4);
			expect((await store.held()).length, "and the span they cover is recorded as held").toBeGreaterThan(0);
			// A fresh log (a reload) on the same device: the held span and the events come back without the server.
			const held = await store.held();
			resetEventsSnapshot();
			setEventStore(store);
			calls = [];
			await registerTail("view", 3);
			expect(calls, "served from the device: no server page").toEqual([]);
			expect(eventsInWindow("view").map((e) => e.id)).toEqual(["0.2", "0.3", "0.4"]);
			expect(held.length).toBeGreaterThan(0);
		});

		it("without the server, serves what the device holds and says what it could not load", async () => {
			await registerTail("view", 10);
			await new Promise((r) => setTimeout(r, 0));
			resetEventsSnapshot();
			setEventStore(store);
			handle.teardown();
			handle = setupShuTest({
				dispatch: () => {
					throw new Error("offline");
				},
			});
			await registerTail("view", 10);
			expect(eventsInWindow("view").map((e) => e.id), "the device's copy still shows").toEqual(["0.1", "0.2", "0.3", "0.4"]);
			expect(eventsUnavailable(), "and the reader is told what could not be loaded, rather than a false 'no events'").toBe(EVENTS_UNAVAILABLE);
		});

		it("two views asking for a tail at the same moment (boot) share the one page, and neither mistakes it for the start of the run", async () => {
			// The monitor and the document both register at boot. The second asker used to be handed an empty placeholder
			// for the page in flight, read it as "nothing older exists", and stopped every later widening at the newest page.
			await Promise.all([registerTail("monitor", 3), registerTail("document", 3)]);
			expect(calls.length, "one page fetched, shared").toBe(1);
			expect(eventsInWindow("monitor").map((e) => e.id)).toEqual(["0.2", "0.3", "0.4"]);
			expect(eventsInWindow("document").map((e) => e.id)).toEqual(["0.2", "0.3", "0.4"]);
			expect(claimReachesStart("document"), "the run has an older event, so the start is NOT held").toBe(false);
			await registerTail("document", 10);
			expect(eventsInWindow("document").map((e) => e.id), "and widening still reaches it").toEqual(["0.1", "0.2", "0.3", "0.4"]);
		});

		it("persists events lean: no inline artifact content, no step value map, products reduced to their display fields", async () => {
			await registerWindow("a-view", [{ from: 0, to: Number.POSITIVE_INFINITY }]); // a view holds the whole run, so a live event is kept
			mergeEvents([
				ev(9, { kind: "artifact", content: "BIG IMAGE BYTES", stepValuesMap: { a: 1 }, products: { view: "v", _type: "T", payload: { huge: "x".repeat(100) } } }),
			]);
			await new Promise((r) => setTimeout(r, 0));
			const [stored] = await store.newestBefore(undefined, 1);
			expect(stored.content, "an artifact's bytes are fetched by path, never read back from the store").toBeUndefined();
			expect(stored.stepValuesMap).toBeUndefined();
			expect(stored.products, "only what the views display").toEqual({ view: "v", _type: "T" });
			expect(stored.id, "the event itself is still there").toBe("0.9");
		});

		it("leanForStore keeps an event without bulk as it is", () => {
			expect(leanForStore(ev(1))).toEqual(ev(1));
		});

		it("a tail at a level is the newest N AT THAT LEVEL, even when the newest events of all are below it", async () => {
			// The run's newest events are instrumentation at debug level; the document shows log and up. Its tail must be the
			// newest page of what it shows, paged by level on the server and in the device's store — not a page of debug
			// events it cannot show, which left it with nothing to render and nothing to widen from.
			handle.teardown();
			const LOG = [ev(1, { level: "info" }), ev(2, { level: "info" }), ev(3, { level: "info" }), ...Array.from({ length: 20 }, (_, i) => ev(10 + i, { level: "debug" }))];
			handle = setupShuTest({
				dispatch: (method, params) => {
					if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
					const filter = (params as { filter: { until?: number; limit?: number; minLevel?: string } }).filter;
					calls.push(filter);
					const floor = filter.minLevel ? ["debug", "trace", "log", "info", "warn", "error"].indexOf(filter.minLevel) : 0;
					const atLevel = LOG.filter((e) => ["debug", "trace", "log", "info", "warn", "error"].indexOf(String(e.level)) >= floor);
					return windowed(atLevel, filter, filter.limit ?? 100);
				},
			});
			await registerTail("document", 2, "log");
			expect(calls[0], "the page is asked for at the document's levels").toMatchObject({ limit: 2, minLevel: "log" });
			expect(eventsInWindow("document").map((e) => e.id), "the newest two the document shows").toEqual(["0.2", "0.3"]);
			expect(currentEvents().every((e) => e.level !== "debug"), "nothing it does not show was kept for it").toBe(true);
			// A live debug event is not wanted by a claim at log and up; a live info event is.
			mergeEvents([ev(40, { level: "debug" }), ev(41, { level: "info" })]);
			expect(eventsInWindow("document").map((e) => e.id)).toEqual(["0.2", "0.3", "0.41"]);
			expect(currentEvents().some((e) => e.id === "0.40"), "a level no view shows is not retained").toBe(false);
			// Widening at that level reaches the run's first event the document shows.
			await registerTail("document", 10, "log");
			expect(eventsInWindow("document").map((e) => e.id)).toEqual(["0.1", "0.2", "0.3", "0.41"]);
			expect(claimReachesStart("document")).toBe(true);
		});

		it("a short page the server marks truncated is a buffer's edge, not the run's: the walk goes on past it", async () => {
			handle.teardown();
			const LOG = Array.from({ length: 12 }, (_, i) => ev(i + 1));
			handle = setupShuTest({
				dispatch: (method, params) => {
					if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
					const filter = (params as { filter: { until?: number; limit?: number } }).filter;
					calls.push(filter);
					// A server whose buffer holds only the newest three: a first page of three, marked truncated; older by `until`.
					if (filter.until === undefined) return { events: LOG.slice(-3), truncated: true };
					return windowed(LOG, filter, filter.limit ?? 100);
				},
			});
			await registerTail("view", 10);
			expect(eventsInWindow("view").length, "ten held, past the short first page").toBe(10);
			expect(claimReachesStart("view"), "and the run's start is not yet held").toBe(false);
		});

		it("a time-span window (a step's own span) is fetched as a gap, and served from the device when held there", async () => {
			await registerWindow("step", [{ from: 2, to: 4 }]);
			expect(eventsInWindow("step").map((e) => e.id)).toEqual(["0.2", "0.3"]);
		});
	});
});
