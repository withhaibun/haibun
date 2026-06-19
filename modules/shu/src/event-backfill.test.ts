import { describe, it, expect } from "vitest";
import { fetchAllEvents } from "./event-backfill.js";
import { recentEventsWithinBudget } from "./monitor-stepper.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";

/** A server-side getEvents stand-in: the real `recentEventsWithinBudget` windowing over an `until`-filtered set. */
function serverFor(events: THaibunEvent[], countCap: number, byteBudget = 1e12) {
	return (window: { until?: number }) => {
		let filtered = events;
		if (window.until !== undefined) filtered = filtered.filter((e) => e.timestamp <= (window.until as number));
		return Promise.resolve(recentEventsWithinBudget(filtered, countCap, byteBudget));
	};
}

const mk = (n: number, ts = (i: number) => i): THaibunEvent[] =>
	Array.from({ length: n }, (_, i) => ({ id: `${ts(i)}.1`, kind: "log", level: "info", timestamp: ts(i), message: `m${i}`, source: "x" }) as unknown as THaibunEvent);

describe("fetchAllEvents", () => {
	it("returns everything in one page when the server doesn't truncate", async () => {
		const events = mk(30);
		const all = await fetchAllEvents(serverFor(events, 1000));
		expect(all.length).toBe(30);
		expect(all.map((e) => e.timestamp)).toEqual(events.map((e) => e.timestamp));
	});

	it("pages backward to assemble the full history despite a small window, oldest-first", async () => {
		const events = mk(100);
		const all = await fetchAllEvents(serverFor(events, 10)); // window holds only 10 — forces ~12 pages
		expect(all.length).toBe(100);
		expect(all[0].timestamp).toBe(0); // the very first event is present (not front-truncated)
		expect(all[99].timestamp).toBe(99);
		expect(all.map((e) => e.timestamp)).toEqual([...Array(100).keys()]); // strictly chronological, no gaps/dupes
	});

	it("de-dupes the inclusive cursor overlap (one shared event per page boundary)", async () => {
		const events = mk(25);
		const all = await fetchAllEvents(serverFor(events, 5));
		const ids = all.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length); // no duplicates
		expect(all.length).toBe(25);
	});

	it("terminates on dense same-timestamp events that can't all fit a window (no infinite loop)", async () => {
		const events = mk(50, () => 7); // all share timestamp 7
		const all = await fetchAllEvents(serverFor(events, 10));
		expect(all.length).toBeLessThanOrEqual(50);
		expect(all.length).toBeGreaterThan(0); // returns what fits rather than hanging
	});

	it("stops cleanly when there are no events", async () => {
		const all = await fetchAllEvents(serverFor([], 10));
		expect(all).toEqual([]);
	});
});
