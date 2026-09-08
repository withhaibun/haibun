// @vitest-environment jsdom
// The views of a run, over the records it wrote. A run is in the graph: a step is one record carrying how it went, and
// what it said and produced point back at it. So a step is one row rather than a start paired with an end, and a
// heading is the step that declared the feature or the scenario.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { ShuDocumentColumn } from "./shu-document-column.js";
import { WINDOW_CHANGED, ShuVirtualColumn } from "./shu-virtual-column.js";
import { SCROLL_TO_INDEX } from "./shu-scrollbar.js";
import type { WindowedSource } from "../windowed-source.js";
import { html } from "lit";
import { timeCursor } from "../signals.js";
import { DEFAULT_WINDOW_SIZE, windowSizeSetting } from "../window-size-setting.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { SHU_TAG } from "../consts.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { setGraphStore } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { resetGraphRunSources } from "../client-cache/graph-run-source.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const iso = (n: number): string => new Date(n).toISOString();

/** A step the run recorded: what it asked for, what it called, how it went, and when. */
const stepRecord = (i: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: `0.${i}`,
	stepText: `step ${i}`,
	called: "TestStepper.aStep",
	actionStatus: "passed",
	ranVia: "local",
	level: "info",
	generatedAtTime: iso(i),
	endedAtTime: iso(i),
	...over,
});

/** The run in the graph, with nothing to ask a server for: the views read the records. */
async function aRun(records: Array<Record<string, unknown>>, said: Array<Record<string, unknown>> = []): Promise<void> {
	const store = new QuadStore();
	for (const record of records) await store.upsertIndividual(SEQ_PATH_LABEL, record);
	for (const record of said) await store.upsertIndividual(LOG_MESSAGE_LABEL, record);
	setGraphStore(store);
	setSiteMetadata({
		types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL],
		rels: { [SEQ_PATH_LABEL]: {}, [LOG_MESSAGE_LABEL]: {}, [RUN_ARTIFACT_LABEL]: {} },
		edgeRanges: {},
	} as unknown as SiteMetadata);
}

describe("the views of a run, over the records it wrote", () => {
	let handle: TShuTestHandle;
	beforeEach(async () => {
		if (!customElements.get(SHU_TAG.MONITOR_COLUMN)) customElements.define(SHU_TAG.MONITOR_COLUMN, ShuMonitorColumn);
		if (!customElements.get(SHU_TAG.DOCUMENT_COLUMN)) customElements.define(SHU_TAG.DOCUMENT_COLUMN, ShuDocumentColumn);
		delete (globalThis as unknown as Record<string, unknown>)["__SHU_QUADS_SNAPSHOT_STORE__"];
		resetGraphRunSources();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("the views read the run's records, not a server");
			},
		});
		await aRun([stepRecord(1), stepRecord(2)]);
	});
	afterEach(() => handle.teardown());

	const open = async <T extends HTMLElement>(tag: string): Promise<T> => {
		const view = document.createElement(tag) as T;
		document.body.appendChild(view);
		await flush();
		await flush();
		return view;
	};

	it("shows a step as one row, which is what its record is", async () => {
		const mon = await open<ShuMonitorColumn>(SHU_TAG.MONITOR_COLUMN);
		expect(mon.rows.map((r) => r.step)).toEqual(["step 1", "step 2"]);
	});

	it("states on the row where the step ran and how it went, rather than pairing it with a separate account of the same act", async () => {
		const mon = await open<ShuMonitorColumn>(SHU_TAG.MONITOR_COLUMN);
		expect(mon.rows[0]).toMatchObject({ status: "passed", ranVia: "local" });
	});

	it("shows what a step said as its own row, under the step it was said during", async () => {
		resetGraphRunSources();
		await aRun([stepRecord(1)], [{ id: "0.1@said", message: "it said this", level: "warn", generatedAtTime: iso(1), isPartOf: "0.1" }]);
		const mon = await open<ShuMonitorColumn>(SHU_TAG.MONITOR_COLUMN);
		expect(mon.rows.map((r) => r.message)).toContain("it said this");
	});

	it("does not show a reader the traffic of whoever is reading the run", async () => {
		resetGraphRunSources();
		await aRun([stepRecord(1), stepRecord(2, { stepText: "graph query", called: "MonitorStepper.graphQuery", level: "trace" })]);
		const mon = await open<ShuMonitorColumn>(SHU_TAG.MONITOR_COLUMN);
		expect(mon.rows.map((r) => r.step), "a call made into the instance reports under the run's own steps").toEqual(["step 1"]);
	});

	it("places the cursor at a row's instant, and at the newest row places it at the live edge so every view follows again", async () => {
		const mon = await open<ShuMonitorColumn>(SHU_TAG.MONITOR_COLUMN);
		const times = Array.from(mon.shadowRoot?.querySelectorAll(".time-group") ?? []) as HTMLElement[];
		expect(times.length).toBe(2);
		timeCursor.set(999);
		times[0].click();
		expect(timeCursor.get(), "the first row: its instant").toBe(1);
		times[1].click();
		expect(timeCursor.get(), "the newest row: the live edge").toBeNull();
	});

	it("renders the run as blocks, and an update about something else re-renders the same ones", async () => {
		const doc = await open<ShuDocumentColumn>(SHU_TAG.DOCUMENT_COLUMN);
		const count = () => doc.shadowRoot?.querySelectorAll(".doc-row").length ?? 0;
		const before = count();
		expect(before).toBeGreaterThan(0);
		doc.requestUpdate();
		await flush();
		expect(count()).toBe(before);
	});

	it("scrubs to a document row's own instant, and to the live edge at the newest", async () => {
		const doc = await open<ShuDocumentColumn>(SHU_TAG.DOCUMENT_COLUMN);
		const rows = (Array.from(doc.shadowRoot?.querySelectorAll(".doc-row[data-raw-time]") ?? []) as HTMLElement[]).sort(
			(a, b) => parseFloat(a.getAttribute("data-raw-time") ?? "0") - parseFloat(b.getAttribute("data-raw-time") ?? "0"),
		);
		expect(rows.length).toBeGreaterThan(1);
		timeCursor.set(123);
		rows[rows.length - 1].click();
		expect(timeCursor.get(), "the newest row: the live edge").toBeNull();
		rows[0].click();
		expect(timeCursor.get(), "an earlier row: its own instant").toBe(1);
	});

	it("titles a feature and a scenario by the step that declared them", async () => {
		resetGraphRunSources();
		await aRun([
			stepRecord(1, { id: "0.1", stepText: "Feature: A run to read", called: "Haibun.feature" }),
			stepRecord(2, { id: "0.2", stepText: "Scenario: Something happens", called: "Haibun.scenario" }),
			stepRecord(3, { id: "0.3", stepText: "A step of it" }),
		]);
		const doc = await open<ShuDocumentColumn>(SHU_TAG.DOCUMENT_COLUMN);
		const headings = Array.from(doc.shadowRoot?.querySelectorAll(".header-block") ?? []).map((h) => h.textContent?.trim() ?? "");
		expect(headings.some((h) => h.includes("A run to read"))).toBe(true);
		expect(headings.some((h) => h.includes("Something happens"))).toBe(true);
	});

	it("records the step that showed a view, and opens no copy of that view in the manual", async () => {
		resetGraphRunSources();
		await aRun([stepRecord(1), stepRecord(2, { stepText: "show the graph", called: "TestStepper.showGraph", showed: "test-view" })]);
		setSiteMetadata({
			types: [SEQ_PATH_LABEL],
			rels: { [SEQ_PATH_LABEL]: {} },
			edgeRanges: {},
			ui: { "test-view": { component: "test-view-element", summary: "the test view" } },
		} as unknown as SiteMetadata);
		const doc = await open<ShuDocumentColumn>(SHU_TAG.DOCUMENT_COLUMN);
		expect(doc.shadowRoot?.textContent).toContain("show the graph");
		expect(doc.shadowRoot?.querySelector("shu-product-view"), "a manual records what a step showed; what that view looked like is the run's own screenshot").toBeNull();
	});

	it("shows no rows when the run has recorded nothing, rather than a false one", async () => {
		resetGraphRunSources();
		await aRun([]);
		const doc = await open<ShuDocumentColumn>(SHU_TAG.DOCUMENT_COLUMN);
		expect(doc.shadowRoot?.querySelectorAll(".doc-row").length ?? 0).toBe(0);
	});
});

describe("the virtual column over a paged source", () => {
	// A source that pages the run in is requested the rows the column shows: every row in the headless fallback (which
	// renders them all), and, as a strip, the rows the rail is dragged to — and the strip reports where its window went.
	type TSpy = WindowedSource<number> & { requested: Array<[number, number]> };
	const spy = (total: number): TSpy => {
		const requested: Array<[number, number]> = [];
		return {
			requested,
			count: () => total,
			rowAt: (i) => i,
			ensureRange: (a, b) => {
				requested.push([a, b]);
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

	it("requests from the source for every row it renders in the headless fallback", async () => {
		const src = spy(7);
		const col = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		col.source = src;
		col.renderRow = (_i, row) => html`<div class="r">${String(row)}</div>`;
		document.body.appendChild(col);
		await col.updateComplete;
		expect(src.requested.at(0), "all seven, since all seven are painted").toEqual([0, 7]);
		expect(col.querySelectorAll(".r").length).toBe(7);
	});

	it("as a strip, a rail seek requests the rows the rail was dragged to and reports where its window went", async () => {
		const src = spy(1000);
		const col = document.createElement("shu-virtual-column") as ShuVirtualColumn;
		col.source = src;
		col.spine = true;
		col.renderRow = (_i, row) => html`<div class="r">${String(row)}</div>`;
		const moves: Array<{ first: number; total: number }> = [];
		col.addEventListener(WINDOW_CHANGED, (e) => moves.push((e as CustomEvent<{ first: number; total: number }>).detail));
		document.body.appendChild(col);
		await col.updateComplete;
		src.requested.length = 0;
		col.dispatchEvent(new CustomEvent(SCROLL_TO_INDEX, { detail: { index: 400, by: "press" }, bubbles: true, composed: true }));
		await col.updateComplete;
		expect(src.requested.at(-1)?.[0], "the rows from where the rail was dragged to").toBe(400);
		expect(moves.at(-1), "and the strip reports where its window went, over the whole run").toMatchObject({ first: 400, total: 1000 });
	});
});
