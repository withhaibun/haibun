// @vitest-environment jsdom
// The client cache view is THE reading of what the page caches of the run: each run source's extent, cached spans and
// cursor row, the live stream by level, what the device stores; every value under its own test id, so a feature reads
// cache facts from here with the generic steps. It watches everything that moves and makes no source of its own.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuClientCacheColumn } from "./shu-client-cache-column.js";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { windowSizeSetting, DEFAULT_WINDOW_SIZE } from "../window-size-setting.js";
import { timeCursor } from "../signals.js";
import { deviceStore, currentRun } from "../client-cache/index.js";
import { SHU_TAG } from "../consts.js";

const IDS = SHU_TEST_IDS.CLIENT_CACHE;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
/** Long enough for the device to have been read again after a change. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 600));
const step = (i: number): Record<string, unknown> => ({ id: `[0.${i}]`, timestamp: 1000 + i, kind: "lifecycle", type: "step", stage: "start", in: `step ${i}`, level: "info", run: "r1", idx: { debug: i, trace: i, log: i, info: i } });

describe("the client cache view", () => {
	let handle: TShuTestHandle;
	const EVENTS = 70;
	beforeEach(() => {
		if (!customElements.get(SHU_TAG.CLIENT_CACHE_COLUMN)) customElements.define(SHU_TAG.CLIENT_CACHE_COLUMN, ShuClientCacheColumn);
		if (!customElements.get(SHU_TAG.MONITOR_COLUMN)) customElements.define(SHU_TAG.MONITOR_COLUMN, ShuMonitorColumn);
		windowSizeSetting.set("50");
		const all = Array.from({ length: EVENTS }, (_, i) => step(i));
		handle = setupShuTest({
			dispatch: (method, params) => {
				if (method !== "MonitorStepper-getEvents") throw new Error(`unexpected ${method}`);
				const { offset, limit } = (params as { filter: { offset?: number; limit?: number } }).filter;
				const extent = { total: EVENTS, first: 1000, run: "r1" };
				if (offset === undefined) return { events: all.slice(-(limit ?? 1)), ...extent };
				return { events: all.slice(offset, offset + (limit ?? 100)), ...extent };
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
		timeCursor.set(null);
	});

	const open = async (): Promise<ShuClientCacheColumn> => {
		const view = document.createElement(SHU_TAG.CLIENT_CACHE_COLUMN) as ShuClientCacheColumn;
		document.body.appendChild(view);
		await flush();
		return view;
	};
	const value = (view: ShuClientCacheColumn, id: string): string | undefined => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
	const text = (view: ShuClientCacheColumn): string => view.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";

	it("reports what it does not know as pending, never as absent", async () => {
		const view = document.createElement(SHU_TAG.CLIENT_CACHE_COLUMN) as ShuClientCacheColumn;
		document.body.appendChild(view);
		await view.updateComplete; // before the device has been read once
		expect(text(view), "the device has not been read yet, so nothing is claimed about it").toContain("Waiting");
		expect(text(view)).not.toContain("No run cached on this device");
		await settle();
		expect(text(view), "read, and now empty").toContain("No run cached on this device");
	});

	it("lists no source until a view has read the run, and makes none itself", async () => {
		const view = await open();
		expect(text(view)).toContain("No view has read the run yet");
		expect(value(view, IDS.CURSOR)).toBe("live edge");
		expect(value(view, IDS.REGISTRY), "no step list has been requested in this page").toBe("not known yet");
	});

	it("reads a source's extent, page size, cached spans and state, and what the device stores of the last run, each under its id", async () => {
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN)); // reads the run at info: 70 events, two pages
		await flush();
		await flush();
		const view = await open();
		await settle();
		expect(value(view, `${IDS.SOURCE}info-events`), "the run's extent at info").toBe(String(EVENTS));
		expect(value(view, `${IDS.SOURCE}info-page`)).toBe("50");
		expect(value(view, `${IDS.SOURCE}info-cached`), "the whole run cached (the headless fallback renders every row)").toBe(`0..${EVENTS - 1}`);
		expect(value(view, `${IDS.SOURCE}info-cached-rows`)).toBe(String(EVENTS));
		expect(value(view, `${IDS.SOURCE}info-cursor`), "no cursor: the live edge, no row").toBe("");
		expect(value(view, `${IDS.SOURCE}info-state`)).toBe("loaded");
		expect(value(view, `${IDS.STORE}info-stored`), "the device store: every event of the run cached at info").toBe(String(EVENTS));
		expect(value(view, `${IDS.STORE}info-extent`), "and the extent cached").toBe(String(EVENTS));
		expect(value(view, `${IDS.STORE}debug-stored`), "a level no view has read the run at is not listed, since it repeats one figure").toBeUndefined();
		expect(text(view)).toContain(`${EVENTS} events cached for this run`);
	});

	it("shows every change at once: a source made after it opened, the cursor's row in it, and the live stream by level", async () => {
		const view = await open();
		expect(text(view)).toContain("No event has arrived since this view opened");
		expect(text(view), "what the live counts are measured from: the device's time when the view opened").toMatch(/Live stream since this view opened \(device time \d\d:\d\d:\d\d\.\d\d\d\)/);
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN)); // a source made after this view opened
		await flush();
		await flush();
		expect(value(view, `${IDS.SOURCE}info-events`), "listed from the moment it exists").toBe(String(EVENTS));
		timeCursor.set(1010);
		await view.updateComplete;
		expect(value(view, IDS.CURSOR)).toContain("00:00:01.010");
		expect(value(view, `${IDS.SOURCE}info-cursor`), "the cursor at 1010 sits on row 10 (timestamp 1000 + 10), shown without waiting for the device").toBe("10");
		handle.emit(step(EVENTS)); // a live info event: the extent grows, the view follows at once
		handle.emit({ id: "noise", timestamp: 2000, kind: "log", level: "debug", message: "below every open view's level", run: "r1", idx: { debug: EVENTS } });
		await flush();
		await flush();
		expect(value(view, `${IDS.SOURCE}info-events`)).toBe(String(EVENTS + 1));
		expect(value(view, `${IDS.LIVE}info`), "the live stream by level: one at info").toBe("1");
		expect(value(view, `${IDS.LIVE}debug`), "and one at debug, which no open view retains").toBe("1");
	});

	it("lists the runs this device caches and reads the one a reader chooses", async () => {
		// A finished run the device caches, beside the run the server is recording.
		const store = deviceStore();
		await store.putMany([
			{ id: "[0]", timestamp: 500, kind: "lifecycle", type: "feature", stage: "start", featureName: "An earlier run", level: "info", run: "earlier", idx: { debug: 0, trace: 0, log: 0, info: 0 } },
		]);
		await store.setExtent("earlier", "info", { total: 1, first: 500, last: 500 });
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN));
		await flush();
		const view = await open();
		await settle();
		const row = (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${IDS.RUN}earlier"]`) as HTMLElement;
		expect(row, "the cached run is listed").not.toBeNull();
		expect(value(view, `${IDS.RUN}r1-reading`), "the run the sources read says so").toBe("reading");
		(row.querySelector(`[data-testid="${IDS.RUN}earlier-read"]`) as HTMLButtonElement).click();
		await flush();
		await flush();
		expect(currentRun(), "the reader's run is the one being read").toBe("earlier");
		expect(value(view, `${IDS.RUN}earlier-reading`)).toBe("reading");
		expect(value(view, `${IDS.RUN}earlier-features`), "a run is presented by what it ran").toBe("An earlier run");
	});

	it("every instant it reports is clickable: clicking one scrubs every view to that moment, and the live edge is one click away", async () => {
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN));
		await flush();
		await flush();
		const view = await open();
		await settle();
		const button = (id: string): HTMLButtonElement | null => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"] button`);
		expect(button(`${IDS.SOURCE}info-first`), "the run's first instant is a control").not.toBeNull();
		button(`${IDS.SOURCE}info-first`)?.click();
		expect(timeCursor.get(), "the run's first instant").toBe(1000);
		await view.updateComplete;
		button(`${IDS.SOURCE}info-newest`)?.click();
		expect(timeCursor.get(), "its newest instant is the live edge, so every view follows again").toBeNull();
		// A cached span scrubs to the first row it caches.
		timeCursor.set(999);
		button(`${IDS.SOURCE}info-cached`)?.click();
		expect(timeCursor.get()).toBe(1000);
		const toLive = (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${IDS.CURSOR}"] button`) as HTMLButtonElement;
		toLive.click();
		expect(timeCursor.get(), "back to the live edge").toBeNull();
	});
});
