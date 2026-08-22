// @vitest-environment jsdom
// Feature-level coverage of the event views over the ONE run source per level: the monitor shows every event (the
// "monitor wasn't showing all events" symptom), a second view at the same level reuses the one source rather than
// re-paging, and the document renders the run's rows from the same source, with nothing asked for twice.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
import { WINDOW_CHANGED, ShuVirtualColumn } from "./shu-virtual-column.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { WindowedSource } from "../windowed-source.js";
import { html } from "lit";
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

	it("a click on a monitor row's time places the cursor at that instant; on the newest row it is the live edge, null, so every view follows again", async () => {
		const mon = document.createElement("shu-monitor-column") as ShuMonitorColumn;
		document.body.appendChild(mon);
		await flush();
		await flush();
		const times = Array.from(mon.shadowRoot?.querySelectorAll(".time-group") ?? []) as HTMLElement[];
		expect(times.length).toBe(2);
		timeCursor.set(999);
		times[0].click();
		expect(timeCursor.get(), "the first row: its instant").toBe(1);
		times[1].click();
		expect(timeCursor.get(), "the newest row: the live edge").toBeNull();
	});

	it("each kind of view pages its own source once, and a second view of the same kind reuses it rather than re-paging", async () => {
		document.body.appendChild(document.createElement("shu-monitor-column")); // the run by index, at info
		await flush();
		await flush();
		expect(backfillCalls, "the monitor's page of the run").toBe(1);
		document.body.appendChild(document.createElement("shu-document-column")); // the run by index, at log and up
		await flush();
		await flush();
		expect(backfillCalls, "the document's source reads its page from the device: the monitor's page put those events there").toBe(1);
		document.body.appendChild(document.createElement("shu-document-column")); // a second document
		await flush();
		await flush();
		expect(backfillCalls, "the second document shares the first's source").toBe(1);
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
describe("the document reads the run source: the whole run by index, one row per event, nothing asked for twice", () => {
	let handle: TShuTestHandle;
	const WINDOW = 50; // a page of the run source
	const EVENTS = 60; // more than a page
	const feature = { id: "0", timestamp: 0, kind: "lifecycle", type: "feature", stage: "start", featureName: "Shu SPA self test", featurePath: "/f.feature", level: "info", idx: { debug: 0, trace: 0, log: 0, info: 0 } };
	/** The run: a feature start, then EVENTS steps (each at index i, after the feature at 0). */
	const all = (): Array<Record<string, unknown>> => [feature, ...Array.from({ length: EVENTS }, (_, i) => { const e = step(i + 1); return { ...e, idx: { debug: i + 1, trace: i + 1, log: i + 1, info: i + 1 } }; })];

	let pageCalls: Array<{ offset?: number; limit?: number; minLevel?: string }>;
	let events: Array<Record<string, unknown>>;
	beforeEach(() => {
		if (!customElements.get("shu-document-column")) customElements.define("shu-document-column", ShuDocumentColumn);
		if (!customElements.get("shu-monitor-column")) customElements.define("shu-monitor-column", ShuMonitorColumn);
		windowSizeSetting.set(String(WINDOW));
		pageCalls = [];
		events = all();
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const filter = (params as { filter: { until?: number; limit?: number; minLevel?: string; offset?: number } }).filter;
				if (filter.offset !== undefined) pageCalls.push(filter);
				return answer(events, filter);
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
	});

	const rows = (doc: ShuDocumentColumn): HTMLElement[] =>
		(Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);
	const open = async (): Promise<ShuDocumentColumn> => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		await flush();
		return doc;
	};

	it("renders every event of the run it holds as its row, the feature's heading first, each page of the run fetched once", async () => {
		const doc = await open();
		expect(rows(doc).length, "the heading and the 60 steps").toBe(EVENTS + 1);
		expect(doc.shadowRoot?.querySelector(`[data-testid="doc-heading-shu-spa-self-test"]`), "the feature heading, named for the feature").not.toBeNull();
		// The two pages the run spans at this level are contiguous, so the source asks for them in ONE call, at the level shown.
		expect(pageCalls.map((c) => `${c.minLevel}:${c.offset}+${c.limit}`), "the whole run at the document's level, once").toEqual([`log:0+${EVENTS + 1}`]);
		await flush();
		expect(pageCalls.length, "nothing asked again once held").toBe(1);
	});

	it("a live event at its level is one more row, without a fetch; one below its level is none; the rows keep their place", async () => {
		const doc = await open();
		const before = rows(doc).map((r) => r.getAttribute("data-raw-time"));
		const asked = pageCalls.length;
		handle.emit({ ...step(EVENTS + 1), idx: { debug: EVENTS + 1, trace: EVENTS + 1, log: EVENTS + 1, info: EVENTS + 1 } });
		await flush();
		await flush();
		const after = rows(doc).map((r) => r.getAttribute("data-raw-time"));
		expect(after.length, "one live step: one more row").toBe(before.length + 1);
		expect(after.slice(0, before.length), "the rows already there are the same rows").toEqual(before);
		handle.emit({ id: "noise", timestamp: EVENTS + 2, kind: "log", level: "debug", message: "not shown at log and up", idx: { debug: EVENTS + 2 } });
		await flush();
		expect(rows(doc).length, "a debug event is below the document's level: no row").toBe(before.length + 1);
		expect(pageCalls.length, "the live edge grows without a fetch").toBe(asked);
	});

	it("a clicked row scrubs the shared cursor to its own instant, from the run's first instant; the newest row is the live edge", async () => {
		const doc = await open();
		timeCursor.set(999); // a non-null start so the published cutoff registers as a change
		const row11 = rows(doc).find((r) => r.getAttribute("data-raw-time") === "11"); // step 11 at timestamp 11; the run began at 0
		row11?.click();
		expect(timeCursor.get(), "clicked row → its own timestamp").toBe(11);
		rows(doc).at(-1)?.click();
		expect(timeCursor.get(), "the newest row is the live edge: no cutoff").toBeNull();
	});

	it("a monitor and a document at the same level read ONE source: each page of the run fetched once between them", async () => {
		const doc = await open();
		// The reader turns the document to info (the monitor's level): another level is another source, read the same way.
		const select = doc.shadowRoot?.querySelector("select") as HTMLSelectElement;
		select.value = "info";
		select.dispatchEvent(new Event("change"));
		await flush();
		await flush();
		const mon = document.createElement("shu-monitor-column") as ShuMonitorColumn;
		document.body.appendChild(mon);
		await flush();
		await flush();
		// The document's page at log put every event on the device; at info the same events are read back from it, for both views.
		expect(pageCalls.map((c) => `${c.minLevel}:${c.offset}+${c.limit}`), "the server asked once, for the run at log").toEqual([`log:0+${EVENTS + 1}`]);
		expect(mon.rows.length, "the monitor shows the run from the same source").toBe(EVENTS + 1);
		expect(rows(doc).length, "and so does the document, at its new level").toBe(EVENTS + 1);
	});

	it("tells its column which rows render nothing, so they take no room and do not drag the height estimate", async () => {
		const doc = await open();
		const column = (doc.shadowRoot as ShadowRoot).querySelector("shu-virtual-column") as unknown as { source: { rowSize?: (i: number) => number | undefined } };
		const source = column.source;
		expect(source.rowSize?.(1), "step 1's start: its row has the step line").toBeUndefined();
		handle.emit({ ...step(EVENTS + 1), stage: "end", idx: { debug: EVENTS + 1, trace: EVENTS + 1, log: EVENTS + 1, info: EVENTS + 1 } });
		await flush();
		await flush();
		expect(source.rowSize?.(EVENTS + 1), "a step's end renders nothing in the document: a row of no height").toBe(0);
		expect(source.rowSize?.(EVENTS + 5), "a row not held: unknown, to be measured or estimated").toBeUndefined();
	});

	it("without the server and nothing on the device, says so rather than showing a false empty document", async () => {
		handle.teardown();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("offline");
			},
		});
		const doc = await open();
		expect(doc.shadowRoot?.querySelector(".unavailable")?.textContent).toContain("could not be reached");
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

	it("as a strip that has never shown rows, a following column's rail sits at the live edge, not at row one", async () => {
		const col = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		col.source = spy(100);
		col.follow = true;
		col.spine = true;
		col.renderRow = (_i, row) => html`<div class="r">${String(row)}</div>`;
		document.body.appendChild(col);
		await col.updateComplete;
		const rail = col.querySelector("shu-scrollbar") as unknown as { window: { first: number; visible: number }; total: number };
		expect(rail.total).toBe(100);
		expect(rail.window, "the last row: where a following column is").toEqual({ first: 99, visible: 1 });
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
