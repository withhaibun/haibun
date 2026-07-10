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

	it("the document renders the log and a benign re-render does not wipe its DOM (no destroy-on-update)", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		const body = doc.shadowRoot?.querySelector(".document-body") as HTMLElement;
		expect(body.innerHTML.length).toBeGreaterThan(0);
		const marker = document.createElement("span");
		marker.id = "survivor";
		body.appendChild(marker);
		doc.requestUpdate(); // an update unrelated to events must NOT re-run renderFull
		await flush();
		expect(doc.shadowRoot?.querySelector("#survivor")).not.toBeNull(); // a renderFull-on-update would have destroyed it
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

// A long log is windowed to its last N rows (shu-window-size). The rows still carry a data-raw-time, and clicking one
// must scrub to that row's real instant — measured from the column's global start, the same origin cursorToRow adds it
// back to — not from the window's first event, which would shift every click earlier by the cut span.
describe("a windowed document scrubs to the clicked row's real time, not the cut-off start", () => {
	let handle: TShuTestHandle;
	const WINDOW = 50; // shrink the window well below the event count so the log is truncated
	const CUT = 10; // events 1..CUT are truncated away
	const EVENTS = WINDOW + CUT; // 60 events → the last 50 render, so the earliest VISIBLE event is CUT+1 (11)

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

	it("clicking the earliest VISIBLE row scrubs to that row's timestamp (11), not the invisible global start (1)", async () => {
		const doc = document.createElement("shu-document-column") as ShuDocumentColumn;
		document.body.appendChild(doc);
		await flush();
		const rows = (Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);
		expect(rows.length, "the window truncates the 60-event log to its last 50 rows").toBe(WINDOW);
		timeCursor.set(999); // a non-null start so the published cutoff registers as a change
		rows[0].click(); // earliest VISIBLE row is event CUT+1 (events 1..CUT were cut) — scrub to ITS instant
		expect(timeCursor.get(), "earliest visible row → its own timestamp, not the cut-off start").toBe(CUT + 1);
	});
});
