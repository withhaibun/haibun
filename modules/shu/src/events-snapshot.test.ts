// @vitest-environment jsdom
// The shared event log: one backfill paged from the byte-bounded getEvents, one dedup, fanned out to every consumer —
// the events analog of quads-snapshot. These pin the contract the monitor/document/step-detail/sequence views rely on.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerTail, registerWindow, eventsInWindow, atRunStart, eventsUnavailable, EVENTS_UNAVAILABLE, setEventStore, currentEvents, mergeEvents, subscribeEvents, eventKey, resetEventsSnapshot, type TEventRecord } from "./events-snapshot.js";
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
	beforeEach(() => resetEventsSnapshot());

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
			expect(atRunStart()).toBe(true);
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

		it("a time-span window (a step's own span) is fetched as a gap, and served from the device when held there", async () => {
			await registerWindow("step", [{ from: 2, to: 4 }]);
			expect(eventsInWindow("step").map((e) => e.id)).toEqual(["0.2", "0.3"]);
		});
	});
});
