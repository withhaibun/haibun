// @vitest-environment jsdom
// Feature-level coverage of the migrated event consumers over the ONE shared log: the monitor shows every event (the
// "monitor wasn't showing all events" symptom), a second consumer reuses the single backfill rather than re-paging, and
// the document no longer destroys its rendered DOM on a benign re-render (the destroy-on-update High bug).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
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
				backfillCalls++;
				const filter = (params as { filter: { until?: number } }).filter;
				if (filter.until !== undefined) return { events: [], truncated: false }; // nothing older
				return { events: [step(1), step(2)], truncated: false };
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

// P4a removes the windowTail cut: the whole run renders (virtualized to the viewport in a real browser; every row in
// jsdom, which has no ResizeObserver). Clicking a row still scrubs to that row's real instant — measured from the
// column's global start, the same origin cursorToRow adds it back to — so a click never shifts by any cut span.
describe("the document renders the whole run and scrubs a clicked row to its real time (no windowTail cut)", () => {
	let handle: TShuTestHandle;
	const WINDOW = 50; // a window size well below the event count: the document must ignore it now, showing every event
	const EVENTS = 60;

	beforeEach(() => {
		if (!customElements.get("shu-document-column")) customElements.define("shu-document-column", ShuDocumentColumn);
		resetEventsSnapshot();
		windowSizeSetting.set(String(WINDOW));
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				if ((params as { filter: { until?: number } }).filter.until !== undefined) return { events: [], truncated: false };
				return { events: Array.from({ length: EVENTS }, (_, i) => step(i + 1)), truncated: false };
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
	});

	it("renders every event (the 500-cut is gone) and a clicked row scrubs to its own instant", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		const rows = (Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);
		expect(rows.length, "the whole 60-event run renders, not a 50-row window").toBe(EVENTS);
		timeCursor.set(999); // a non-null start so the published cutoff registers as a change
		const row11 = rows.find((r) => r.getAttribute("data-raw-time") === "10"); // event 11: rawTime 10 from the global start (1)
		row11?.click();
		expect(timeCursor.get(), "clicked row → its own timestamp (start 1 + rawTime 10)").toBe(11);
	});
});
