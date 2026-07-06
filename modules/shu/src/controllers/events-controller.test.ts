// @vitest-environment jsdom
// EventsController owns the one event pathway for a view: backfill the shared log once on connect, re-derive via the
// onChange callback, merge live batches, and (in snapshot-pinned mode) take no live updates. A tiny host exercises it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { html } from "lit";
import { z } from "zod";
import { ShuElement } from "../components/shu-element.js";
import { EventsController } from "./events-controller.js";
import { resetEventsSnapshot, registerWindow, eventsInWindow, currentEvents, type TEventRecord } from "../events-snapshot.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

const SCHEMA = z.object({});

class TestHost extends ShuElement<typeof SCHEMA> {
	#events = new EventsController(this, () => this.onEventsChanged());
	changes: string[][] = [];
	get loaded(): boolean {
		return this.#events.loaded;
	}
	constructor() {
		super(SCHEMA, {});
	}
	private onEventsChanged(): void {
		this.changes.push(this.#events.all.map((e) => String(e.id)));
	}
	render() {
		return html``;
	}
}
if (!customElements.get("test-events-host")) customElements.define("test-events-host", TestHost);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const ev = (i: number): TEventRecord => ({ id: `0.${i}`, timestamp: i, kind: "log", message: `e${i}` });

describe("EventsController", () => {
	let handle: TShuTestHandle;
	let backfillCalls: number;
	beforeEach(() => {
		resetEventsSnapshot();
		backfillCalls = 0;
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				backfillCalls++;
				const filter = (params as { filter: { until?: number } }).filter;
				if (filter.until !== undefined) return { events: [], truncated: false }; // nothing older
				return { events: [ev(1), ev(2)], truncated: false };
			},
		});
	});
	afterEach(() => handle.teardown());

	const mount = (attrs: Record<string, string> = {}): TestHost => {
		const el = document.createElement("test-events-host") as TestHost;
		for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		document.body.appendChild(el); // connect → hostConnected → backfill + subscribe
		return el;
	};

	it("backfills the shared log on connect and re-derives once it lands", async () => {
		const el = mount();
		await flush();
		expect(el.changes.at(-1)).toEqual(["0.1", "0.2"]);
		expect(backfillCalls).toBe(1);
	});

	it("merges a live batch and re-derives", async () => {
		const el = mount();
		await flush();
		handle.emit(ev(3));
		await flush();
		expect(el.changes.at(-1)).toEqual(["0.1", "0.2", "0.3"]);
	});

	it("backfills only once across two hosts (shared cache)", async () => {
		const a = mount();
		const b = mount();
		await flush();
		expect(backfillCalls).toBe(1);
		expect(a.changes.at(-1)).toEqual(["0.1", "0.2"]);
		expect(b.changes.at(-1)).toEqual(["0.1", "0.2"]);
	});

	it("in data-snapshot-time mode takes the backfill but no live updates", async () => {
		const el = mount({ "data-snapshot-time": "5" });
		await flush();
		const afterBackfill = el.changes.length;
		handle.emit(ev(3));
		await flush();
		expect(el.changes.length).toBe(afterBackfill); // pinned: no live re-derive
	});

	it("loaded is false until the backfill resolves, then true — a view shows retrieving, never a false empty", async () => {
		const el = mount();
		expect(el.loaded).toBe(false); // mounted, backfill in flight — must not look "empty"
		await flush();
		expect(el.loaded).toBe(true); // retrieved
	});
});

// The range-windowing core: a consumer registers a bounded span; the cache fetches only that span (bounded getEvents),
// its slice is filtered to the window, and narrowing the window evicts the events no window still wants.
describe("events range windowing", () => {
	let handle: TShuTestHandle;
	let filters: Array<{ since?: number; until?: number }>;
	beforeEach(() => {
		resetEventsSnapshot();
		filters = [];
		// A synthetic timeline t=1..5; getEvents honours the since/until filter (the server's real behaviour).
		const timeline: TEventRecord[] = [1, 2, 3, 4, 5].map((i) => ({ id: `0.${i}`, timestamp: i, kind: "log" }));
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const f = (params as { filter: { since?: number; until?: number } }).filter;
				filters.push(f);
				const lo = f.since ?? Number.NEGATIVE_INFINITY;
				const hi = f.until ?? Number.POSITIVE_INFINITY;
				return { events: timeline.filter((e) => Number(e.timestamp) >= lo && Number(e.timestamp) <= hi), truncated: false };
			},
		});
	});
	afterEach(() => handle.teardown());

	it("fetches only the registered span and reads back only that slice", async () => {
		await registerWindow("w", [{ from: 2, to: 4 }]); // half-open [2,4) → t=2,3
		expect(filters.at(-1)).toMatchObject({ since: 2, until: 4 }); // bounded getEvents, not the whole history
		expect(eventsInWindow("w").map((e) => e.timestamp)).toEqual([2, 3]);
	});

	it("narrowing a window evicts the events no window still wants", async () => {
		await registerWindow("w", [{ from: 0, to: 10 }]); // holds t=1..5
		expect(currentEvents().map((e) => e.timestamp)).toEqual([1, 2, 3, 4, 5]);
		const fetchesAfterFull = filters.length;
		await registerWindow("w", [{ from: 0, to: 3 }]); // narrow → t=1,2; t=3,4,5 orphaned
		expect(currentEvents().map((e) => e.timestamp)).toEqual([1, 2]);
		expect(filters.length).toBe(fetchesAfterFull); // narrowing fetches nothing — the span was already held
	});
});
