// @vitest-environment jsdom
// The run as a view at one level reads it: a source spanning the whole run by index, paged in from the device's store
// first and the server for what the device lacks, grown by live events that carry their index, bounded in what it holds,
// and honest when a page cannot be had. These pin the contract the monitor's whole-run rail relies on.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eventRunSource, resetRunSources, runSpan, setRunSourceStore, leanForStore, EVENTS_UNAVAILABLE, type TEventRecord } from "./run-source.js";
import { MemoryEventStore } from "./event-store.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { windowSizeSetting, DEFAULT_WINDOW_SIZE } from "../components/shu-window-size.js";

/** Live batches are coalesced into an animation frame; this lets one land. */
const flush = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const LEVELS = ["debug", "trace", "log", "info", "warn", "error"];
/** A run of `n` events, every third at info and the rest at debug, each stamped with its index per level as the server stamps it. */
function run(n: number): TEventRecord[] {
	const counts: Record<string, number> = {};
	return Array.from({ length: n }, (_, i) => {
		const level = i % 3 === 0 ? "info" : "debug";
		const idx: Record<string, number> = {};
		for (const l of LEVELS.slice(0, LEVELS.indexOf(level) + 1)) idx[l] = counts[l] = (counts[l] ?? 0) + 1;
		for (const l of Object.keys(idx)) idx[l]--;
		return { id: `0.${i}`, timestamp: 1000 + i, kind: "log", level, message: `e${i}`, idx };
	});
}
/** The server's answer to a page by index at a level, with the run's extent; `run` names the run it records (settable). */
function serverFor(initial: TEventRecord[], run = "") {
	const calls: Array<Record<string, unknown>> = [];
	const state = { all: initial, run };
	const dispatch = (method: string, params: unknown) => {
		if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
		const filter = (params as { filter: { minLevel?: string; offset?: number; limit?: number } }).filter;
		calls.push(filter);
		const level = filter.minLevel ?? "debug";
		const all = state.all.map((e) => (state.run ? { ...e, run: state.run } : e));
		const at = all.filter((e) => (e.idx as Record<string, number>)[level] !== undefined);
		const first = all[0]?.timestamp;
		const extent = { total: at.length, first, ...(state.run ? { run: state.run } : {}) };
		if (filter.offset === undefined) return { events: at.slice(-(filter.limit ?? 1)), ...extent };
		return { events: at.filter((e) => { const i = (e.idx as Record<string, number>)[level]; return i >= (filter.offset as number) && i < (filter.offset as number) + (filter.limit ?? 100); }), ...extent };
	};
	return { calls, dispatch, state };
}

describe("the run source at a level", () => {
	let handle: TShuTestHandle;
	let store: MemoryEventStore;
	const ALL = run(180); // 180 events: 60 at info, 180 at debug — more than one page of the smallest window size
	let server: ReturnType<typeof serverFor>;
	beforeEach(() => {
		windowSizeSetting.set("50"); // a page is the shared window size; the smallest, so a run has several
		server = serverFor(ALL);
		handle = setupShuTest({ dispatch: server.dispatch }); // starts the sources afresh over a memory store of its own
		store = new MemoryEventStore();
		setRunSourceStore(store); // this test's store, so what the sources persist can be read back here
	});
	afterEach(() => {
		handle.teardown();
		resetRunSources();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
	});

	it("spans the run's whole extent at its level once ready, from one ask", async () => {
		const info = eventRunSource("info");
		await info.ready();
		expect(info.count(), "sixty events at info and up").toBe(60);
		expect(info.extent().first, "and when the run began").toBe(1000);
		expect(eventRunSource("debug").count(), "another level is another source, not yet asked").toBe(0);
		await eventRunSource("debug").ready();
		expect(eventRunSource("debug").count()).toBe(180);
	});

	it("pages any region in by index and serves it by index, leaving the rest unresident", async () => {
		const info = eventRunSource("info");
		await info.ready();
		expect(info.rowAt(4), "not fetched yet").toBeUndefined();
		await info.ensureRange(3, 6);
		expect((info.rowAt(4) as TEventRecord).id, "the fifth info event is event 12").toBe("0.12");
		expect(info.rowAt(55), "beyond the page that was asked: still unresident").toBeUndefined();
		await info.ensureRange(55, 58);
		expect((info.rowAt(55) as TEventRecord).id, "paged in on demand: the 56th info event is event 165").toBe("0.165");
	});

	it("serves a page the device holds whole without the server, and persists what the server sends", async () => {
		const info = eventRunSource("info");
		await info.ready();
		await info.ensureRange(0, 50);
		await new Promise((r) => setTimeout(r, 0));
		const asked = server.calls.length;
		resetRunSources(); // a reload: sources anew over the same device store
		setRunSourceStore(store);
		const again = eventRunSource("info");
		await again.ready();
		await again.ensureRange(0, 50);
		expect(server.calls.length - asked, "one ask for the extent, none for the page the device held").toBe(1);
		expect((again.rowAt(0) as TEventRecord).id).toBe("0.0");
	});

	it("places a live event at the index it carries and grows the extent; a missed one leaves a gap the next page fills", async () => {
		const info = eventRunSource("info");
		await info.ready();
		await info.ensureRange(50, 60); // the last page resident (info indices 50..59)
		const more = run(186).slice(180); // six more events: two at info (180 and 183 → info indices 60 and 61)
		handle.emit(more[0]); // event 180, info index 60
		await flush();
		expect(info.count()).toBe(61);
		expect((info.rowAt(60) as TEventRecord).id, "appended in place, at the end of the resident last page").toBe("0.180");
		handle.emit(more[3]); // event 183, info index 61
		await flush();
		expect(info.count(), "the extent grows to include it").toBe(62);
		expect((info.rowAt(61) as TEventRecord).id).toBe("0.183");
	});

	it("without the server, spans the extent the device last knew and serves its cached pages; with nothing cached, says so", async () => {
		const info = eventRunSource("info");
		await info.ready();
		await info.ensureRange(0, 50);
		await new Promise((r) => setTimeout(r, 0));
		handle.teardown();
		handle = setupShuTest({ dispatch: () => { throw new Error("offline"); } });
		resetRunSources();
		setRunSourceStore(store);
		const offline = eventRunSource("info");
		await offline.ready();
		expect(offline.count(), "the extent the device knew").toBe(60);
		await offline.ensureRange(0, 50);
		expect((offline.rowAt(49) as TEventRecord).id, "from the device").toBe("0.147");
		expect(offline.unavailable).toBeNull();
		// a level the device never saw: nothing to span, and the reader is told
		const cold = eventRunSource("error");
		await cold.ready();
		expect(cold.count()).toBe(0);
		expect(cold.unavailable).toBe(EVENTS_UNAVAILABLE);
	});

	it("holds one run: when the server names a new run, the source starts over in it", async () => {
		handle.teardown();
		server = serverFor(ALL, "run-1");
		handle = setupShuTest({ dispatch: server.dispatch });
		const info = eventRunSource("info");
		await info.ready();
		await info.ensureRange(0, 50);
		expect(info.count()).toBe(60);
		expect((info.rowAt(0) as TEventRecord).id).toBe("0.0");
		// The instance is run again: a shorter run 2, named on its live events and on every answer.
		server.state.all = run(30);
		server.state.run = "run-2";
		const fresh = { ...run(31)[30], run: "run-2" }; // a live event of run 2 (debug, index 30; info index 10)
		handle.emit(fresh);
		await flush();
		await info.ready();
		await flush();
		expect(info.count(), "run 2's extent: ten at info, and the live one").toBe(11);
		expect(info.rowAt(0), "run 1's rows are gone until run 2's page lands").toBeUndefined();
		await info.ensureRange(0, 11);
		expect((info.rowAt(0) as TEventRecord).run).toBe("run-2");
	});

	it("reaching the live edge fetches the last page once, and reaching it again fetches nothing", async () => {
		const info = eventRunSource("info");
		await info.ready();
		const end = info.count();
		await info.ensureRange(Math.max(0, end - 10), end);
		const asked = server.calls.length;
		for (let i = 0; i < 5; i++) await info.ensureRange(Math.max(0, end - 10), end); // at the bottom, again and again
		expect(server.calls.length, "the last page is resident: nothing more is asked").toBe(asked);
		expect(info.count(), "and nothing grew").toBe(end);
	});

	it("a live burst at the level adds exactly its rows to the extent and fetches nothing; events below the level add none", async () => {
		const info = eventRunSource("info");
		await info.ready();
		await info.ensureRange(50, 60); // the last page resident
		const asked = server.calls.length;
		const burst = run(189).slice(180); // nine more events: three at info (180, 183, 186 → info 60, 61, 62), six at debug
		server.state.all = run(189); // the server recorded them too
		for (const e of burst) handle.emit(e);
		await flush();
		expect(info.count(), "three at info and up: three more").toBe(63);
		expect(server.calls.length, "placed by their index, not fetched").toBe(asked);
		expect((info.rowAt(62) as TEventRecord).id).toBe("0.186");
		const debugOnly = eventRunSource("debug");
		await debugOnly.ready();
		expect(debugOnly.count(), "the debug source counts them all").toBe(189);
	});

	it("knows the run's span: its first instant from the server, its newest from the newest event, moved on by live ones; the page size is the shared window size", async () => {
		const src = eventRunSource("info");
		await src.ready();
		expect(src.extent().first).toBe(1000);
		expect(src.extent().last, "the newest info event (index 177)").toBe(1177);
		expect(src.pageSize).toBe(50);
		expect(runSpan(), "the span the playback and the actions bar read, without asking for a window").toEqual({ first: 1000, last: 1177 });
		handle.emit({ id: "0.180", timestamp: 1180, kind: "log", level: "info", message: "e180", idx: { debug: 180, trace: 180, log: 180, info: 60 } });
		await flush();
		expect(src.extent().last).toBe(1180);
		expect(runSpan().last).toBe(1180);
	});

	it("says which index spans it holds resident, joined where pages touch, so a view derives from them rather than scanning the extent", async () => {
		const src = eventRunSource("info");
		await src.ready();
		expect(src.residentRanges()).toEqual([]);
		await src.ensureRange(0, 20);
		await src.ensureRange(50, 60);
		expect(src.residentRanges(), "page 0 (50) and the short page 1 (10), touching").toEqual([{ from: 0, to: 60 }]);
	});

	it("persists events lean: no inline artifact content, no step value map, products reduced to their display fields; an event without bulk as it is", async () => {
		const src = eventRunSource("info");
		await src.ready();
		handle.emit({ id: "0.180", timestamp: 1180, kind: "artifact", level: "info", content: "BIG IMAGE BYTES", stepValuesMap: { a: 1 }, products: { view: "v", _type: "T", payload: { huge: "x".repeat(100) } }, idx: { info: 60 } });
		await flush();
		const [stored] = await store.pageAt("", "info", 60, 61);
		expect(stored.content, "an artifact's bytes are fetched by path, never read back from the store").toBeUndefined();
		expect(stored.stepValuesMap).toBeUndefined();
		expect(stored.products, "only what the views display").toEqual({ view: "v", _type: "T" });
		expect(leanForStore({ id: "a", timestamp: 1 })).toEqual({ id: "a", timestamp: 1 });
	});
});
