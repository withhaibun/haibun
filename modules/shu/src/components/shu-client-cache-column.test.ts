// @vitest-environment jsdom
// The client cache view is THE reading of what the page holds of a run: each source's extent, the rows it holds and the
// cursor's row in it, the live stream by level, and the executions this device holds; every value under its own test
// id, so a feature reads what the page holds from here with the generic steps. It makes no source of its own.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { ShuClientCacheColumn } from "./shu-client-cache-column.js";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { timeCursor } from "../signals.js";
import { setGraphStore } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { currentExecution, graphRunSource, resetExecutions } from "../client-cache/index.js";
import { resetGraphRunSources } from "../client-cache/graph-run-source.js";
import { SHU_TAG } from "../consts.js";

const IDS = SHU_TEST_IDS.CLIENT_CACHE;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
/** Long enough for what the device holds to have been read again after a change. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));
const iso = (n: number): string => new Date(n).toISOString();
const RUN = "1700000000000-1";
const EARLIER = "1600000000000-1";

/** A step of an execution, as its record. */
const step = (execution: string, i: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: `${execution}.0.${i}`,
	stepText: `step ${i}`,
	called: "TestStepper.aStep",
	actionStatus: "passed",
	level: "info",
	generatedAtTime: iso(1000 + i),
	...over,
});

describe("the client cache view", () => {
	let handle: TShuTestHandle;
	const STEPS = 70;
	beforeEach(async () => {
		if (!customElements.get(SHU_TAG.CLIENT_CACHE_COLUMN)) customElements.define(SHU_TAG.CLIENT_CACHE_COLUMN, ShuClientCacheColumn);
		if (!customElements.get(SHU_TAG.MONITOR_COLUMN)) customElements.define(SHU_TAG.MONITOR_COLUMN, ShuMonitorColumn);
		resetGraphRunSources();
		resetExecutions();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("the views read the run's records");
			},
		});
		setSiteMetadata({ types: [SEQ_PATH_LABEL], rels: { [SEQ_PATH_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
		// The execution being recorded, and an earlier one this device still holds, each named by the feature it ran.
		const store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, step(EARLIER, 0, { stepText: "Feature: An earlier run", called: "Haibun.feature", generatedAtTime: iso(500) }));
		await store.upsertIndividual(SEQ_PATH_LABEL, step(RUN, 0, { stepText: "Feature: The run being recorded", called: "Haibun.feature" }));
		for (let i = 1; i < STEPS; i++) await store.upsertIndividual(SEQ_PATH_LABEL, step(RUN, i));
		setGraphStore(store);
	});
	afterEach(() => {
		handle.teardown();
		resetGraphRunSources();
		resetExecutions();
		timeCursor.set(null);
		document.body.innerHTML = "";
	});

	/** A view reading the run at info, which is what this view reports on: the source, not whoever opened it. */
	const readingTheRun = async (): Promise<void> => {
		await graphRunSource("info").ready();
		await flush();
	};

	const open = async (): Promise<ShuClientCacheColumn> => {
		const view = document.createElement(SHU_TAG.CLIENT_CACHE_COLUMN) as ShuClientCacheColumn;
		document.body.appendChild(view);
		await flush();
		return view;
	};
	const value = (view: ShuClientCacheColumn, id: string): string | undefined => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
	const text = (view: ShuClientCacheColumn): string => view.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";

	it("reports what it does not know as pending, never as absent", async () => {
		setGraphStore(new QuadStore());
		const view = document.createElement(SHU_TAG.CLIENT_CACHE_COLUMN) as ShuClientCacheColumn;
		document.body.appendChild(view);
		await view.updateComplete; // before what the device holds has been read once
		expect(text(view), "what this device holds has not been read yet, so nothing is claimed about it").toContain("Waiting");
		expect(text(view)).not.toContain("No execution is held on this device");
		await settle();
		expect(text(view), "read, and now empty").toContain("No execution is held on this device");
	});

	it("lists no source until a view has read the run, and makes none itself", async () => {
		const view = await open();
		expect(text(view)).toContain("No view has read the run yet");
		expect(value(view, IDS.CURSOR)).toBe("live edge");
		expect(value(view, IDS.REGISTRY), "no step list has been requested in this page").toBe("not known yet");
	});

	it("reads a source's extent, the rows it holds and its state, each under its id", async () => {
		await readingTheRun();
		const view = await open();
		await settle();
		expect(value(view, `${IDS.SOURCE}info-events`), "the run's extent at info").toBe(String(STEPS));
		expect(value(view, `${IDS.SOURCE}info-cached`), "the window a reader is looking at").toBe(`0..${STEPS - 1}`);
		expect(value(view, `${IDS.SOURCE}info-cached-rows`)).toBe(String(STEPS));
		expect(value(view, `${IDS.SOURCE}info-cursor`), "no cursor: the live edge, no row").toBe("");
		expect(value(view, `${IDS.SOURCE}info-loaded`), "what the source is doing is its own id, so a reader waits for the state rather than for a cell about to change").toBe("loaded");
	});

	it("shows every change at once: a source made after it opened, the cursor's row in it, and the live stream by level", async () => {
		const view = await open();
		expect(text(view)).toContain("No event has arrived since this view opened");
		expect(text(view), "what the live counts are measured from: the device's time when the view opened").toMatch(/Live stream since this view opened \(device time \d\d:\d\d:\d\d\.\d\d\d\)/);
		await readingTheRun(); // a source made after this view opened
		expect(value(view, `${IDS.SOURCE}info-events`), "listed from the moment it exists").toBe(String(STEPS));
		timeCursor.set(1010);
		await view.updateComplete;
		expect(value(view, IDS.CURSOR)).toContain("00:00:01.010");
		expect(value(view, `${IDS.SOURCE}info-cursor`), "the cursor at 1010 sits on row 10, shown without waiting for the device").toBe("10");
		handle.emit({ id: "0.1", timestamp: 2000, kind: "log", level: "info", message: "the run says something" });
		handle.emit({ id: "0.2", timestamp: 2000, kind: "log", level: "debug", message: "below every open view's level" });
		await flush();
		expect(value(view, `${IDS.LIVE}info`), "the live stream by level: one at info").toBe("1");
		expect(value(view, `${IDS.LIVE}debug`), "and one at debug, which no open view shows").toBe("1");
	});

	it("lists the executions this device holds and reads the one a reader chooses", async () => {
		await readingTheRun();
		const view = await open();
		await settle();
		const row = (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${IDS.RUN}${EARLIER}"]`) as HTMLElement;
		expect(row, "the earlier execution is listed").not.toBeNull();
		expect(value(view, `${IDS.RUN}${RUN}-reading`), "the execution the sources read says so").toBe("reading");
		(row.querySelector(`[data-testid="${IDS.RUN}${EARLIER}-read"]`) as HTMLButtonElement).click();
		await flush();
		await settle();
		expect(currentExecution(), "the reader's execution is the one being read").toBe(EARLIER);
		expect(value(view, `${IDS.RUN}${EARLIER}-reading`)).toBe("reading");
		expect(value(view, `${IDS.RUN}${EARLIER}-features`), "an execution is presented by what it ran").toBe("An earlier run");
	});

	it("every instant it reports is clickable: clicking one scrubs every view to that moment, and the live edge is one click away", async () => {
		await readingTheRun();
		const view = await open();
		await settle();
		const button = (id: string): HTMLButtonElement | null => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"] button`);
		expect(button(`${IDS.SOURCE}info-first`), "the run's first instant is a control").not.toBeNull();
		button(`${IDS.SOURCE}info-first`)?.click();
		expect(timeCursor.get(), "the first instant of the run being read, which is not the earlier one this device also holds").toBe(1000);
		await view.updateComplete;
		button(`${IDS.SOURCE}info-newest`)?.click();
		expect(timeCursor.get(), "its newest instant is the live edge, so every view follows again").toBeNull();
		timeCursor.set(999);
		button(`${IDS.SOURCE}info-cached`)?.click();
		expect(timeCursor.get(), "a span scrubs to the first row it holds").toBe(1000);
		const toLive = (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${IDS.CURSOR}"] button`) as HTMLButtonElement;
		toLive.click();
		expect(timeCursor.get(), "back to the live edge").toBeNull();
	});
});
