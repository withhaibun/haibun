// @vitest-environment jsdom
// Feature-level coverage of the migrated event consumers over the ONE shared log: the monitor shows every event (the
// "monitor wasn't showing all events" symptom), a second consumer reuses the single backfill rather than re-paging, and
// the document no longer destroys its rendered DOM on a benign re-render (the destroy-on-update High bug).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
import { resetEventsSnapshot } from "../events-snapshot.js";
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
});
