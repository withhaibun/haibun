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

	it("completes a page the buffer cannot fill from the log, and says when older events still remain", () => {
		const stepper = harness();
		try {
			for (let i = 0; i < 600; i++) stepper.recordEvent(ev(i)); // maxEvents 5 + trim slack: the buffer holds a tail
			const short = page(stepper, { limit: 10 });
			expect(short.events.length, "the page asked for, from buffer and log together").toBe(10);
			expect(short.truncated, "older events exist beyond this page, on the run's disk log").toBe(true);
			const whole = page(stepper, {});
			expect(whole.events.length, "no limit: the whole run up to the count cap, buffer and log together").toBe(600);
			expect(whole.truncated, "nothing older remains").toBe(false);
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
	it("returns the step's own events (its bracketed id) and its dispatch trace, from the buffer, from the log when older, and from the log alone when this process did not record them", () => {
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
			for (let i = 0; i < 600; i++) {
				stepper.recordEvent(ev(i, { id: `[0.${i}]`, kind: "lifecycle", stage: "start" } as Partial<THaibunEvent>));
				stepper.recordEvent(ev(i, { id: `[0.${i}]`, kind: "lifecycle", stage: "end" } as Partial<THaibunEvent>));
				stepper.recordEvent(ev(i, { id: `dispatch.0.${i}`, kind: "artifact", artifactType: "dispatch-trace", trace: { seqPath: [0, i] } } as unknown as Partial<THaibunEvent>));
			}
			const inBuffer = stepper.steps.getEvents.action({ filter: { seqPath: "0.599" } }).products;
			expect(inBuffer.events.map((e) => `${e.id}:${e.stage ?? e.artifactType}`)).toEqual(["[0.599]:start", "[0.599]:end", "dispatch.0.599:dispatch-trace"]);
			const pastBuffer = stepper.steps.getEvents.action({ filter: { seqPath: "0.7" } }).products;
			expect(pastBuffer.events.map((e) => `${e.id}:${e.stage ?? e.artifactType}`), "older than the buffer holds: found on the log").toEqual(["[0.7]:start", "[0.7]:end", "dispatch.0.7:dispatch-trace"]);
			// The process that recorded the run is gone (a restart): the buffer is empty and untrimmed, the log holds the run.
			(stepper as unknown as { events: THaibunEvent[]; eventsTrimmed: boolean }).events = [];
			(stepper as unknown as { events: THaibunEvent[]; eventsTrimmed: boolean }).eventsTrimmed = false;
			const afterRestart = stepper.steps.getEvents.action({ filter: { seqPath: "0.300" } }).products;
			expect(afterRestart.events.map((e) => e.id), "from the log alone").toEqual(["[0.300]", "[0.300]", "dispatch.0.300"]);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});
});

describe("events at a level and above", () => {
	// Every log view shows a level and up; the server pages a tail by that same rule, so a view whose shown events are
	// older than the newest events of all still gets its own newest page.
	it("returns only events at or above minLevel, newest first within the limit", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: { events: Array<Record<string, unknown>> } } } };
		};
		stepper.eventLogPath = null;
		stepper.diskBuffer = [];
		stepper.maxEvents = 5000;
		for (let i = 0; i < 3; i++) stepper.recordEvent(ev(i, { level: "info" } as Partial<THaibunEvent>));
		for (let i = 10; i < 30; i++) stepper.recordEvent(ev(i, { level: "debug" } as Partial<THaibunEvent>));
		const page = stepper.steps.getEvents.action({ filter: { minLevel: "log", limit: 2 } }).products;
		expect(page.events.map((e) => e.id), "the newest two at log and up, not the newest two of all").toEqual(["0.1", "0.2"]);
		expect(stepper.steps.getEvents.action({ filter: { minLevel: "debug", limit: 2 } }).products.events.map((e) => e.id)).toEqual(["0.28", "0.29"]);
	});
});

describe("a page the buffer cannot fill is completed from the log", () => {
	// Instrumentation at debug level can trim a run's earlier info events out of the live buffer while the buffer is still
	// full of debug. A view that shows info asks for its newest page; the buffer yields a few, and the rest must come from
	// the log — a short page must mean the run has no more, never that the buffer has no more.
	it("fills the page from the log with what is older than the buffer, and says whether more remains", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: { events: Array<Record<string, unknown>>; truncated?: boolean } } } };
		};
		stepper.eventLogPath = join(tmpdir(), `shu-fill-${process.pid}-${Date.now()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = 5; // the buffer keeps the newest five plus slack; the rest lives on the log
		try {
			for (let i = 0; i < 40; i++) stepper.recordEvent(ev(i, { level: "info" } as Partial<THaibunEvent>));
			for (let i = 100; i < 700; i++) stepper.recordEvent(ev(i, { level: "debug" } as Partial<THaibunEvent>)); // trims every info event to the log
			const page = stepper.steps.getEvents.action({ filter: { minLevel: "log", limit: 10 } }).products;
			expect(page.events.map((e) => e.id), "the newest ten at info, from the log since the buffer holds none").toEqual(Array.from({ length: 10 }, (_, i) => `0.${30 + i}`));
			expect(page.truncated, "thirty older remain").toBe(true);
			const rest = stepper.steps.getEvents.action({ filter: { minLevel: "log", until: 1030, limit: 100 } }).products;
			expect(rest.events.map((e) => e.id).at(0)).toBe("0.0");
			expect(rest.truncated, "and now nothing older does").toBe(false);
		} finally {
			if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
		}
	});
});

describe("the run's extent and pages by index", () => {
	// A view whose rail spans the whole run reads it by index: every logged event is stamped with its index at each level
	// it counts toward, every answer carries the run's total at the asked level and when it began, and a page by index
	// comes from the buffer when the buffer holds it, else from the log, read forward from the batch it begins in.
	type TPage = { events: Array<Record<string, unknown>>; total?: number; first?: number };
	const harness = (maxEvents: number) => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			recordEvent(e: THaibunEvent): void;
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: TPage } } };
		};
		stepper.eventLogPath = join(tmpdir(), `shu-index-${process.pid}-${Date.now()}-${Math.random()}.jsonl`);
		stepper.diskBuffer = [];
		stepper.maxEvents = maxEvents;
		return stepper;
	};
	const page = (stepper: ReturnType<typeof harness>, filter: Record<string, unknown>): TPage => stepper.steps.getEvents.action({ filter }).products;
	const cleanup = (stepper: ReturnType<typeof harness>) => {
		if (stepper.eventLogPath && existsSync(stepper.eventLogPath)) rmSync(stepper.eventLogPath);
	};

	it("stamps each event with its index at its own level and every level below, and counts the run's extent per level", () => {
		const stepper = harness(5000);
		try {
			stepper.recordEvent(ev(0, { level: "info" } as Partial<THaibunEvent>));
			stepper.recordEvent(ev(1, { level: "debug" } as Partial<THaibunEvent>));
			stepper.recordEvent(ev(2, { level: "error" } as Partial<THaibunEvent>));
			const all = page(stepper, { offset: 0, limit: 10 });
			expect(all.events.map((e) => e.idx)).toEqual([
				{ debug: 0, trace: 0, log: 0, info: 0 },
				{ debug: 1 },
				{ debug: 2, trace: 1, log: 1, info: 1, warn: 0, error: 0 },
			]);
			expect(all.total, "three events at debug and up").toBe(3);
			expect(page(stepper, { minLevel: "info", offset: 0, limit: 10 }).total, "two at info and up").toBe(2);
			expect(all.first, "when the run began").toBe(1000);
		} finally {
			cleanup(stepper);
		}
	});

	it("serves a page by index from the buffer when it holds it, and from the log across flush batches when it does not", () => {
		const stepper = harness(5); // the buffer keeps the newest few; the log keeps every event in batches of 256
		try {
			for (let i = 0; i < 700; i++) stepper.recordEvent(ev(i, { level: i % 3 === 0 ? "info" : "debug" } as Partial<THaibunEvent>));
			const tail = page(stepper, { minLevel: "debug", offset: 695, limit: 5 });
			expect(tail.events.map((e) => e.id), "from the buffer: the newest").toEqual(["0.695", "0.696", "0.697", "0.698", "0.699"]);
			expect(tail.total).toBe(700);
			const middle = page(stepper, { minLevel: "debug", offset: 250, limit: 10 });
			expect(middle.events.map((e) => e.id), "from the log, across a flush boundary").toEqual(Array.from({ length: 10 }, (_, i) => `0.${250 + i}`));
			const atInfo = page(stepper, { minLevel: "info", offset: 100, limit: 3 });
			expect(atInfo.events.map((e) => e.id), "indexed among info events only: the 101st info event is event 300").toEqual(["0.300", "0.303", "0.306"]);
			expect(atInfo.total, "234 info events in the run").toBe(234);
			expect(page(stepper, { minLevel: "info", offset: 233, limit: 5 }).events.map((e) => e.id), "the last page is short").toEqual(["0.699"]);
			expect(page(stepper, { minLevel: "info", offset: 500, limit: 5 }).events, "past the end: nothing").toEqual([]);
		} finally {
			cleanup(stepper);
		}
	});
});

describe("the run an event belongs to", () => {
	// A stayed instance run again keeps the last run's tail in its buffer. Every event is stamped with its run, every answer
	// names the run being recorded, and an answer holds only that run's events, so a client never sees two runs as one.
	it("stamps events with the run, names it on every answer, and serves only the run being recorded", () => {
		const stepper = new MonitorStepper() as unknown as {
			eventLogPath: string | null;
			diskBuffer: string[];
			maxEvents: number;
			runId: string | undefined;
			recordEvent(e: THaibunEvent): void;
			steps: { getEvents: { action(args: { filter: Record<string, unknown> }): { products: { events: Array<Record<string, unknown>>; run?: string } } } };
		};
		stepper.eventLogPath = null;
		stepper.diskBuffer = [];
		stepper.maxEvents = 5000;
		stepper.runId = "run-a";
		for (let i = 0; i < 3; i++) stepper.recordEvent(ev(i));
		stepper.runId = "run-b"; // the instance is run again: a new run, the old one's events still in the buffer
		for (let i = 10; i < 13; i++) stepper.recordEvent(ev(i));
		const page = stepper.steps.getEvents.action({ filter: {} }).products;
		expect(page.run, "the answer names the run being recorded").toBe("run-b");
		expect(page.events.map((e) => e.id), "and holds only its events").toEqual(["0.10", "0.11", "0.12"]);
		expect(page.events.every((e) => e.run === "run-b"), "each stamped with it").toBe(true);
		expect(stepper.steps.getEvents.action({ filter: { offset: 0, limit: 10 } }).products.events.map((e) => e.id), "by index too").toEqual(["0.10", "0.11", "0.12"]);
	});
});
