// getEvents returns a recent WINDOW, never the whole buffer: a long instrumentation run otherwise accumulates events
// until JSON.stringify hits V8's ~512MB ceiling and the RPC 413s. The window is bounded by both a count cap and a byte
// budget (so a few large events can't blow it), always keeps the newest event, and reports `truncated` honestly.
import { describe, it, expect } from "vitest";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import MonitorStepper, { recentEventsWithinBudget, slimLiveEvent } from "./monitor-stepper.js";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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

describe("the disk event log is the report's full history (never windowed)", () => {
	it("retains every appended event — readEventLog returns all of them, not a recent window", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string;
			diskBuffer: string[];
			appendToEventLog(e: THaibunEvent): void;
			readEventLog(): Record<string, unknown>[];
		};
		const tmp = join(tmpdir(), `shu-events-${process.pid}-${Date.now()}.jsonl`);
		stepper.eventLogPath = tmp;
		stepper.diskBuffer = [];
		try {
			const N = 1000; // far more than any in-memory window (maxEvents) would hold — proves the report isn't truncated
			for (let i = 0; i < N; i++) stepper.appendToEventLog(ev(i, { kind: "lifecycle", type: "step", stage: "end", actionName: `step ${i}` } as Partial<THaibunEvent>));
			const all = stepper.readEventLog();
			expect(all).toHaveLength(N); // every event, across flush boundaries — the full run
			expect((all[0] as { id?: string }).id).toBe("0.0"); // including the very first, which an in-memory ring buffer would have evicted
		} finally {
			if (existsSync(tmp)) rmSync(tmp);
		}
	});
});

describe("a reloading client can page back to the start of the run", () => {
	// The in-memory buffer holds only the newest maxEvents; the run's disk log holds every event. A client that reloads
	// backfills by paging getEvents backward through the `until` cursor (fetchRange), so a page over a trimmed buffer
	// must say it is truncated, and a page reaching past the buffer must be served from the log — otherwise the pager
	// stops at the trim and the document's leading lines never load.
	type TPage = { events: Array<Record<string, unknown>>; truncated?: boolean };
	const harness = () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			leanEventsNewestFirst(chunkBytes?: number): Iterable<Record<string, unknown>>;
			readEventLog(): Record<string, unknown>[];
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: TPage } } };
		};
		stepper.eventLogPath = join(tmpdir(), `shu-page-${process.pid}-${Date.now()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = 5;
		return stepper;
	};
	const page = (stepper: ReturnType<typeof harness>, filter: Record<string, unknown>): TPage => stepper.steps.getEvents.action({ filter }).products;

	it("reports a page over a trimmed buffer as truncated, since older events exist on the log", () => {
		const stepper = harness();
		try {
			for (let i = 0; i < 600; i++) stepper.recordEvent(ev(i)); // maxEvents 5 + trim slack: the buffer holds a tail
			const first = page(stepper, {});
			expect(first.events.length).toBeLessThan(600);
			expect(first.truncated, "older events exist beyond this page, on the run's disk log").toBe(true);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});

	it("serves pages past the buffer from the run's disk log, all the way to the first event", () => {
		const stepper = harness();
		try {
			const N = 600;
			for (let i = 0; i < N; i++) stepper.recordEvent(ev(i));
			// Page backward exactly the way the client's fetchRange does.
			const seen = new Set<string>();
			let until: number | undefined;
			for (let pages = 0; pages < 100; pages++) {
				const { events, truncated } = page(stepper, until === undefined ? {} : { until });
				if (events.length === 0) break;
				for (const e of events) seen.add(String(e.id));
				const earliest = Math.min(...events.map((e) => Number(e.timestamp)));
				if (!truncated) break;
				if (until !== undefined && earliest >= until) break;
				until = earliest;
			}
			expect(seen.size, "every event of the run, not just the buffer's tail").toBe(N);
			expect(seen.has("0.0"), "including the very first").toBe(true);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});
});

describe("reading the disk log backward", () => {
	// A page from the log must not cost the whole log: it is read from the end a chunk at a time, and a line cut by a
	// chunk boundary is carried as bytes until the chunk before it completes it, so nothing is lost or garbled however
	// small the chunk, and a multibyte character on the boundary survives.
	it("yields every event newest first, across chunk boundaries, with multibyte text intact", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			flushEventLog(): void;
			leanEventsNewestFirst(chunkBytes?: number): Iterable<Record<string, unknown>>;
			readEventLog(): Record<string, unknown>[];
		};
		stepper.eventLogPath = join(tmpdir(), `shu-backward-${process.pid}-${Date.now()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = 5;
		try {
			const N = 300;
			for (let i = 0; i < N; i++) stepper.recordEvent(ev(i, { message: `é✅ ${i} ünïcode` } as Partial<THaibunEvent>));
			stepper.flushEventLog(); // everything on disk, so the chunked path is what is exercised
			for (const chunk of [7, 64, 1024]) {
				const backward = [...stepper.leanEventsNewestFirst(chunk)];
				expect(backward.map((e) => e.id), `chunk ${chunk}: the whole log, newest first`).toEqual(stepper.readEventLog().reverse().map((e) => e.id));
				expect(backward[N - 1].message, `chunk ${chunk}: the first line, carried across every boundary`).toBe("é✅ 0 ünïcode");
				expect(backward.every((e) => String(e.message).startsWith("é✅ ")), `chunk ${chunk}: no line garbled`).toBe(true);
			}
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});

	it("yields the lines still buffered before the file, since they are the newest", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			leanEventsNewestFirst(chunkBytes?: number): Iterable<Record<string, unknown>>;
		};
		stepper.eventLogPath = join(tmpdir(), `shu-buffered-${process.pid}-${Date.now()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = 5;
		try {
			for (let i = 0; i < 300; i++) stepper.recordEvent(ev(i)); // 256 flush to disk, the rest stay buffered
			expect(stepper.diskBuffer.length).toBeGreaterThan(0);
			const ids = [...stepper.leanEventsNewestFirst()].map((e) => e.id);
			expect(ids[0]).toBe("0.299");
			expect(ids.at(-1)).toBe("0.0");
			expect(ids).toHaveLength(300);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});
});

describe("one step's own events", () => {
	// A view about one step asks for that step's events by its seqPath, which is its id (start and end share it), so it
	// never has to page the run to find them: from the live buffer, or from the log when the step is older than the buffer.
	it("returns only the events whose id is the seqPath, from the buffer and from the log alike", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: { events: Array<Record<string, unknown>>; truncated?: boolean } } } };
		};
		stepper.eventLogPath = join(tmpdir(), `shu-seq-${process.pid}-${Date.now()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = 5;
		try {
			for (let i = 0; i < 600; i++) stepper.recordEvent(ev(i, { kind: "lifecycle", stage: i % 2 ? "end" : "start" } as Partial<THaibunEvent>));
			const inBuffer = stepper.steps.getEvents.action({ filter: { seqPath: "0.599" } }).products;
			expect(inBuffer.events.map((e) => e.id)).toEqual(["0.599"]);
			const pastBuffer = stepper.steps.getEvents.action({ filter: { seqPath: "0.7", until: 1007 } }).products;
			expect(pastBuffer.events.map((e) => e.id), "older than the buffer holds: found on the log").toEqual(["0.7"]);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});
});
