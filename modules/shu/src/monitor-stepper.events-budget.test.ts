// getEvents returns a recent WINDOW, never the whole buffer: a long instrumentation run otherwise accumulates events
// until JSON.stringify hits V8's ~512MB ceiling and the RPC 413s. The window is bounded by both a count cap and a byte
// budget (so a few large events can't blow it), always keeps the newest event, and reports `truncated` honestly.
import { describe, it, expect } from "vitest";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { recentEventsWithinBudget, slimLiveEvent } from "./monitor-stepper.js";

const ev = (i: number, over: Partial<THaibunEvent> = {}): THaibunEvent =>
	({ id: `0.${i}`, timestamp: 1000 + i, source: "haibun", emitter: `Executor:${i}`, level: "info", kind: "log", message: `e${i}`, ...over }) as unknown as THaibunEvent;

const BIG = 1024 * 1024; // 1MB budget — generous for these tiny events unless the test forces a tight one

describe("recentEventsWithinBudget bounds the getEvents response", () => {
	it("returns everything in chronological order when it fits the budget", () => {
		const { events, truncated } = recentEventsWithinBudget([ev(0), ev(1), ev(2)], 100, BIG);
		expect(events.map((e) => e.id)).toEqual(["0.0", "0.1", "0.2"]);
		expect(truncated).toBe(false);
	});

	it("keeps only the most recent events when the count cap bites, and flags truncation", () => {
		const { events, truncated } = recentEventsWithinBudget([ev(0), ev(1), ev(2), ev(3)], 2, BIG);
		expect(events.map((e) => e.id)).toEqual(["0.2", "0.3"]); // newest two, still chronological
		expect(truncated).toBe(true);
	});

	it("bounds by BYTES so a few large events can't exceed the serialize ceiling", () => {
		const big = (i: number) => ev(i, { message: "x".repeat(2000) } as Partial<THaibunEvent>);
		const tightBudget = 3000; // ~one big event fits
		const { events, truncated } = recentEventsWithinBudget([big(0), big(1), big(2)], 100, tightBudget);
		expect(events.length).toBeLessThan(3);
		expect(events.at(-1)?.id).toBe("0.2"); // the newest is always present
		expect(truncated).toBe(true);
	});

	it("always returns the newest event even when it alone exceeds the budget", () => {
		const huge = ev(0, { message: "x".repeat(10_000) } as Partial<THaibunEvent>);
		const { events } = recentEventsWithinBudget([huge], 100, 10);
		expect(events).toHaveLength(1);
	});

	it("slimLiveEvent drops source/emitter and inline artifact content, and adds seqPath", () => {
		const slim = slimLiveEvent(ev(5, { kind: "artifact", content: "BIG FILE BYTES" } as Partial<THaibunEvent>));
		expect(slim.source).toBeUndefined();
		expect(slim.emitter).toBeUndefined();
		expect(slim.content).toBeUndefined();
		expect(slim.seqPath).toEqual([0, 5]);
	});
});
