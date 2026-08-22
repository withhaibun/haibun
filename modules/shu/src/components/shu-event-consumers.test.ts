// @vitest-environment jsdom
// Feature-level coverage of the migrated event consumers over the ONE shared log: the monitor shows every event (the
// "monitor wasn't showing all events" symptom), a second consumer reuses the single backfill rather than re-paging, and
// the document no longer destroys its rendered DOM on a benign re-render (the destroy-on-update High bug).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
import { FOLLOW_CHANGED, WINDOW_CHANGED, ShuVirtualColumn } from "./shu-virtual-column.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { WindowedSource } from "../windowed-source.js";
import { html } from "lit";
import { resetEventsSnapshot } from "../events-snapshot.js";
import { timeCursor } from "../signals.js";
import { DEFAULT_WINDOW_SIZE, windowSizeSetting } from "./shu-window-size.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const step = (i: number): Record<string, unknown> => ({
	id: `0.${i}`,
	timestamp: i,
	kind: "lifecycle",
	type: "step",
	stage: "start", // the document renders step STARTs; the monitor rows either stage
	in: `step ${i}`,
	level: "info",
	seqPath: [0, i],
	idx: { debug: i - 1, trace: i - 1, log: i - 1, info: i - 1 }, // its index at each level it counts toward, as the server stamps it
});

/** The server's answer: a page by index (offset/limit at a level) with the run's extent, or a page by time (until/limit). */
function answer(all: Array<Record<string, unknown>>, filter: { until?: number; limit?: number; minLevel?: string; offset?: number }): Record<string, unknown> {
	const level = filter.minLevel ?? "debug";
	const at = all.filter((e) => (e.idx as Record<string, number>)[level] !== undefined);
	const extent = { total: at.length, first: all[0]?.timestamp };
	if (filter.offset !== undefined) {
		const events = at.filter((e) => { const i = (e.idx as Record<string, number>)[level]; return i >= (filter.offset as number) && i < (filter.offset as number) + (filter.limit ?? 100); });
		return { events, ...extent };
	}
	const eligible = filter.until === undefined ? at : at.filter((e) => (e.timestamp as number) <= (filter.until as number));
	return { events: filter.limit ? eligible.slice(-filter.limit) : eligible, truncated: false, ...extent };
}

describe("event consumers over the shared log", () => {
	let handle: TShuTestHandle;
	let backfillCalls: number;
	beforeEach(() => {
		if (!customElements.get("shu-monitor-column")) customElements.define("shu-monitor-column", ShuMonitorColumn);
		if (!customElements.get("shu-document-column")) customElements.define("shu-document-column", ShuDocumentColumn);
		resetEventsSnapshot();
		backfillCalls = 0;
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const filter = (params as { filter: { until?: number; limit?: number; minLevel?: string; offset?: number } }).filter;
				// The monitor's run source asks once for the extent (limit 1, no cursor) and then for pages by index; the document's
				// tail asks for the newest page and older pages by `until`. Pages of either kind are counted as backfills.
				if (filter.offset !== undefined || filter.until !== undefined || filter.limit !== 1) backfillCalls++;
				return answer([step(1), step(2)], filter);
			},
		});
	});
	afterEach(() => handle.teardown());

	it("the monitor shows the run's rows from one page, then places live ones by their index without another fetch", async () => {
		const mon = document.createElement("shu-monitor-column") as ShuMonitorColumn;
		document.body.appendChild(mon);
		await flush();
		await flush();
		expect(mon.rows.map((r) => r.step)).toEqual(["step 1", "step 2"]);
		expect(backfillCalls, "the run's one page").toBe(1);
		handle.emit(step(3));
		await flush();
		await flush();
		expect(mon.rows.map((r) => r.step)).toEqual(["step 1", "step 2", "step 3"]);
		expect(backfillCalls, "a live event carries its index: no page is asked for to place it").toBe(1);
	});

	it("the monitor's rows are the run's: a live burst adds exactly its rows, the count reads the extent, and the first row is named", async () => {
		const mon = document.createElement("shu-monitor-column") as ShuMonitorColumn;
		document.body.appendChild(mon);
		await flush();
		await flush();
		expect(mon.rows.length).toBe(2);
		expect(mon.shadowRoot?.querySelector("[data-testid=monitor-log-row-first]"), "the run's first row is on the page, named").toBeTruthy();
		for (const i of [3, 4, 5, 6]) handle.emit(step(i)); // a burst at the live edge
		await flush();
		await flush();
		expect(mon.rows.map((r) => r.step), "four more rows, in order, nothing else").toEqual(["step 1", "step 2", "step 3", "step 4", "step 5", "step 6"]);
		expect(mon.shadowRoot?.querySelector(".count")?.textContent, "the count is the run's extent").toBe("6 events");
		for (const i of [7, 8]) handle.emit({ ...step(i), level: "debug", idx: { debug: i - 1 } }); // below the monitor's level (info)
		await flush();
		await flush();
		expect(mon.rows.length, "debug events are not the monitor's rows at info").toBe(6);
	});

	it("each kind of view pages its own source once, and a second view of the same kind reuses it rather than re-paging", async () => {
		document.body.appendChild(document.createElement("shu-monitor-column")); // the run by index, at info
		await flush();
		await flush();
		expect(backfillCalls, "the monitor's page of the run").toBe(1);
		document.body.appendChild(document.createElement("shu-document-column")); // the log's newest page, at log and up
		await flush();
		await flush();
		expect(backfillCalls, "and the document's: a different source, its own page").toBe(2);
		document.body.appendChild(document.createElement("shu-document-column")); // a second document
		await flush();
		await flush();
		expect(backfillCalls, "shared log: the second document holds what the first fetched, no page-walk").toBe(2);
	});

	it("renders the log as blocks and a benign re-render keeps them (no blank-on-update)", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		const count = () => doc.shadowRoot?.querySelectorAll(".doc-row").length ?? 0;
		const before = count();
		expect(before).toBeGreaterThan(0); // the two backfilled steps rendered as rows
		doc.requestUpdate(); // an update unrelated to events must re-render the same rows, never blank the document
		await flush();
		expect(count()).toBe(before);
	});

	it("clicking the latest document row publishes a null cursor (live edge), an earlier row a concrete cutoff", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		const rows = (Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);
		expect(rows.length).toBeGreaterThan(1);
		timeCursor.set(123); // a non-null start so a published null registers as a change
		rows[rows.length - 1].click(); // latest event row → live edge, so the graph shows everything (matches the slider's at-end null)
		expect(timeCursor.get(), "latest row → null (live)").toBeNull();
		rows[0].click(); // earliest row → a concrete as-of cutoff (the first event's timestamp)
		expect(timeCursor.get(), "earlier row → concrete cutoff").toBe(1);
	});
});

// The whole run renders (virtualized to the viewport in a real browser; every row in jsdom, which has no
// ResizeObserver) — no cap may hide earlier events. Clicking a row scrubs to that row's real instant — measured from
// the column's global start, the same origin cursorToRow adds it back to — so a click never shifts by a hidden span.
describe("the document holds the newest page, widens toward the start, and scrubs a clicked row to its real time", () => {
	let handle: TShuTestHandle;
	const WINDOW = 50; // the window size now counts the events a tailing view holds: one page at the live edge, more as the reader nears the top
	const EVENTS = 60;

	let pageCalls = 0;
	beforeEach(() => {
		if (!customElements.get("shu-document-column")) customElements.define("shu-document-column", ShuDocumentColumn);
		resetEventsSnapshot();
		windowSizeSetting.set(String(WINDOW));
		pageCalls = 0;
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const filter = (params as { filter: { until?: number; limit?: number; minLevel?: string; offset?: number } }).filter;
				pageCalls++;
				return answer(Array.from({ length: EVENTS }, (_, i) => step(i + 1)), filter);
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
	});

	const sortedRows = (doc: ShuDocumentColumn): HTMLElement[] =>
		(Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);

	it("shows its newest page even when the run's newest events are below its level", async () => {
		// The server holds 60 lifecycle events followed by 200 debug events. The document shows log and up: its page is the
		// newest 50 it shows, not an empty page of debug events it does not.
		handle.teardown();
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const filter = (params as { filter: { until?: number; limit?: number; minLevel?: string } }).filter;
				const all = [
					...Array.from({ length: EVENTS }, (_, i) => step(i + 1)),
					...Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, timestamp: EVENTS + 1 + i, kind: "log", level: "debug", message: `noise ${i}` })),
				];
				const floor = filter.minLevel ? ["debug", "trace", "log", "info", "warn", "error"].indexOf(filter.minLevel) : 0;
				const atLevel = all.filter((e) => ["debug", "trace", "log", "info", "warn", "error"].indexOf(String(e.level)) >= floor);
				const eligible = filter.until === undefined ? atLevel : atLevel.filter((e) => (e.timestamp as number) <= (filter.until as number));
				return { events: filter.limit ? eligible.slice(-filter.limit) : eligible, truncated: false };
			},
		});
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		await flush();
		expect(sortedRows(doc).length, "the newest page of what the document shows").toBe(WINDOW);
	});

	it("holds the newest page at the live edge, widens to the start as the reader nears the top, and a clicked row scrubs to its own instant", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		expect(sortedRows(doc).length, "pinned to the live edge: one page of the newest events, not the whole run").toBe(WINDOW);
		// The reader scrolls back and reaches the top of what is held: the document widens by a page, which here is the rest.
		doc.dispatchEvent(new CustomEvent(FOLLOW_CHANGED, { detail: { following: false }, bubbles: true, composed: true }));
		doc.dispatchEvent(new CustomEvent(WINDOW_CHANGED, { detail: { first: 0, visible: 10, total: WINDOW }, bubbles: true, composed: true }));
		await flush();
		await flush();
		const rows = sortedRows(doc);
		expect(rows.length, "the whole 60-event run, reached by widening, no cut").toBe(EVENTS);
		timeCursor.set(999); // a non-null start so the published cutoff registers as a change
		const row11 = rows.find((r) => r.getAttribute("data-raw-time") === "10"); // event 11: rawTime 10 from the global start (1)
		row11?.click();
		expect(timeCursor.get(), "clicked row → its own timestamp (start 1 + rawTime 10)").toBe(11);
	});

	it("scrolling back to the live edge narrows to one page again and adds nothing: no rows, no fetch, however often the edge is reached", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		doc.dispatchEvent(new CustomEvent(FOLLOW_CHANGED, { detail: { following: false }, bubbles: true, composed: true }));
		doc.dispatchEvent(new CustomEvent(WINDOW_CHANGED, { detail: { first: 0, visible: 10, total: WINDOW }, bubbles: true, composed: true }));
		await flush();
		await flush();
		expect(sortedRows(doc).length, "widened to the whole run").toBe(EVENTS);
		const asked = pageCalls;
		// The reader scrolls to the bottom. Reaching the live edge flips follow on — and a scroll that ends there flips it
		// several times on the way (off, on, off, on), as a real scroll does.
		for (const following of [true, false, true, false, true]) doc.dispatchEvent(new CustomEvent(FOLLOW_CHANGED, { detail: { following }, bubbles: true, composed: true }));
		doc.dispatchEvent(new CustomEvent(WINDOW_CHANGED, { detail: { first: WINDOW - 10, visible: 10, total: WINDOW }, bubbles: true, composed: true }));
		await flush();
		await flush();
		expect(sortedRows(doc).length, "back to the newest page: narrowed, nothing added").toBe(WINDOW);
		expect(pageCalls, "narrowing asks the server for nothing").toBe(asked);
		// Reaching the edge again and again changes nothing.
		for (let i = 0; i < 5; i++) doc.dispatchEvent(new CustomEvent(FOLLOW_CHANGED, { detail: { following: true }, bubbles: true, composed: true }));
		await flush();
		expect(sortedRows(doc).length).toBe(WINDOW);
		expect(pageCalls).toBe(asked);
	});

	it("at the live edge a live event at the document's level adds exactly its row, and one below its level adds none", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		expect(sortedRows(doc).length).toBe(WINDOW);
		handle.emit(step(EVENTS + 1));
		await flush();
		await flush();
		expect(sortedRows(doc).length, "one live step: one more row").toBe(WINDOW + 1);
		handle.emit({ id: "noise", timestamp: EVENTS + 2, kind: "log", level: "debug", message: "not shown at log and up", idx: { debug: 0 } });
		await flush();
		await flush();
		expect(sortedRows(doc).length, "a debug event is below the document's level: no row").toBe(WINDOW + 1);
	});
});

describe("the virtual column over a paged source", () => {
	// A source that pages the run in is asked for the rows the column shows: every row in the headless fallback (which
	// renders them all), and, as a strip, the rows the rail is dragged to — and the strip says where its window went.
	type TSpy = WindowedSource<number> & { asked: Array<[number, number]> };
	const spy = (total: number): TSpy => {
		const asked: Array<[number, number]> = [];
		return {
			asked,
			count: () => total,
			rowAt: (i) => i,
			ensureRange: (a, b) => {
				asked.push([a, b]);
				return Promise.resolve();
			},
			subscribe: () => () => undefined,
			markers: () => [],
		};
	};
	beforeEach(() => {
		if (!customElements.get("shu-virtual-column")) customElements.define("shu-virtual-column", ShuVirtualColumn);
	});

	it("asks the source for every row it renders in the headless fallback", async () => {
		const src = spy(7);
		const col = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		col.source = src;
		col.renderRow = (_i, row) => html`<div class="r">${String(row)}</div>`;
		document.body.appendChild(col);
		await col.updateComplete;
		expect(src.asked.at(0), "all seven, since all seven are painted").toEqual([0, 7]);
		expect(col.querySelectorAll(".r").length).toBe(7);
	});

	it("as a strip, a rail seek asks for the rows the rail was dragged to and says where its window went", async () => {
		const src = spy(1000);
		const col = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		col.source = src;
		col.spine = true;
		col.renderRow = (_i, row) => html`<div class="r">${String(row)}</div>`;
		const moves: Array<{ first: number; total: number }> = [];
		col.addEventListener(WINDOW_CHANGED, (e) => moves.push((e as CustomEvent<{ first: number; total: number }>).detail));
		document.body.appendChild(col);
		await col.updateComplete;
		src.asked.length = 0;
		col.dispatchEvent(new CustomEvent(SCROLL_TO_INDEX, { detail: { index: 400, by: "press" }, bubbles: true, composed: true }));
		await col.updateComplete;
		expect(src.asked.at(-1)?.[0], "the rows from where the rail was dragged to").toBe(400);
		expect(moves.at(-1), "and the strip says where its window went, over the whole run").toMatchObject({ first: 400, total: 1000 });
	});
});
