// @vitest-environment jsdom
// Feature-level coverage of the migrated event consumers over the ONE shared log: the monitor shows every event (the
// "monitor wasn't showing all events" symptom), a second consumer reuses the single backfill rather than re-paging, and
// the document no longer destroys its rendered DOM on a benign re-render (the destroy-on-update High bug).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
import { FOLLOW_CHANGED, WINDOW_CHANGED } from "./shu-virtual-column.js";
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
});

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
				const filter = (params as { filter: { until?: number; limit?: number } }).filter;
				backfillCalls++;
				// A tailing view asks for the newest page, then older pages by `until`; this run has two events.
				const all = [step(1), step(2)];
				const eligible = filter.until === undefined ? all : all.filter((e) => (e.timestamp as number) <= (filter.until as number));
				return { events: filter.limit ? eligible.slice(-filter.limit) : eligible, truncated: false };
			},
		});
	});
	afterEach(() => handle.teardown());

	it("the monitor shows every backfilled event, then appends live ones, with one shared backfill", async () => {
		const mon = document.createElement("shu-monitor-column") as ShuMonitorColumn;
		document.body.appendChild(mon);
		await flush();
		expect(mon.rows.map((r) => r.step)).toEqual(["step 1", "step 2"]);
		handle.emit(step(3));
		await flush();
		expect(mon.rows.map((r) => r.step)).toEqual(["step 1", "step 2", "step 3"]);
		expect(backfillCalls).toBe(1);
	});

	it("a second consumer reuses the single backfill instead of re-paging", async () => {
		document.body.appendChild(document.createElement("shu-monitor-column"));
		await flush();
		document.body.appendChild(document.createElement("shu-document-column"));
		await flush();
		expect(backfillCalls).toBe(1); // shared cache: the document read the same log, no second page-walk
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

	beforeEach(() => {
		if (!customElements.get("shu-document-column")) customElements.define("shu-document-column", ShuDocumentColumn);
		resetEventsSnapshot();
		windowSizeSetting.set(String(WINDOW));
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const filter = (params as { filter: { until?: number; limit?: number } }).filter;
				const all = Array.from({ length: EVENTS }, (_, i) => step(i + 1));
				const eligible = filter.until === undefined ? all : all.filter((e) => (e.timestamp as number) <= (filter.until as number));
				return { events: filter.limit ? eligible.slice(-filter.limit) : eligible, truncated: false };
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
});
