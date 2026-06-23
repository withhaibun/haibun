// @vitest-environment jsdom
// The shared event log: one backfill paged from the byte-bounded getEvents, one dedup, fanned out to every consumer —
// the events analog of quads-snapshot. These pin the contract the monitor/document/step-detail/sequence views rely on.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEventSnapshot, currentEvents, mergeEvents, subscribeEvents, eventKey, resetEventsSnapshot, type TEventRecord } from "./events-snapshot.js";
import { setupShuTest, type TShuTestHandle } from "./test-setup.js";

const ev = (i: number, over: TEventRecord = {}): TEventRecord => ({ id: `0.${i}`, timestamp: i, kind: "log", message: `e${i}`, ...over });

/** Simulate the server's byte/count-bounded getEvents: the newest `cap` events with timestamp <= until, truncated if older remain. */
function windowed(all: TEventRecord[], filter: { until?: number }, cap: number): { events: TEventRecord[]; truncated: boolean } {
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

	describe("backfill against a paging service", () => {
		let handle: TShuTestHandle;
		let calls: Array<{ until?: number }>;
		const ALL = [ev(1), ev(2), ev(3), ev(4)];
		beforeEach(() => {
			calls = [];
			handle = setupShuTest({
				dispatch: (method, params) => {
					if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
					const filter = (params as { filter: { until?: number } }).filter;
					calls.push(filter);
					return windowed(ALL, filter, 2); // cap 2 forces backward paging
				},
			});
		});
		afterEach(() => handle.teardown());

		it("pages backward via `until` and assembles the full deduped history oldest-first", async () => {
			const events = await getEventSnapshot();
			expect(events.map((e) => e.id)).toEqual(["0.1", "0.2", "0.3", "0.4"]);
			expect(calls.length).toBeGreaterThan(1); // truncation forced backward paging
		});

		it("caches the backfill — a second call does not re-page", async () => {
			await getEventSnapshot();
			const after = calls.length;
			await getEventSnapshot();
			expect(calls.length).toBe(after);
		});

		it("forceRefresh re-pages from scratch", async () => {
			await getEventSnapshot();
			const after = calls.length;
			await getEventSnapshot({ forceRefresh: true });
			expect(calls.length).toBeGreaterThan(after);
		});

		it("concurrent callers share one in-flight backfill", async () => {
			const [a, b] = await Promise.all([getEventSnapshot(), getEventSnapshot()]);
			expect(a).toBe(b);
			expect(a.map((e) => e.id)).toEqual(["0.1", "0.2", "0.3", "0.4"]);
		});
	});
});
