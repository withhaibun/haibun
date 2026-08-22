// @vitest-environment jsdom
// The client cache view is THE reading of what the page holds of the run: each run source's extent, resident spans and
// cursor row, the live stream by level, what the device stores; every value under its own test id, so a feature reads
// cache facts from here with the generic steps. It watches everything that moves and makes no source of its own.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ShuClientCacheColumn } from "./shu-client-cache-column.js";
import { ShuMonitorColumn } from "./shu-monitor-column.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { windowSizeSetting, DEFAULT_WINDOW_SIZE } from "./shu-window-size.js";
import { timeCursor } from "../signals.js";
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

	it("lists no source until a view has read the run, and makes none itself", async () => {
		const view = await open();
		expect(text(view)).toContain("No view has read the run yet");
		expect(value(view, IDS.CURSOR)).toBe("live edge");
	});

	it("reads a source's extent, page size, resident spans and state, and what the device stores of the last run, each under its id", async () => {
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN)); // reads the run at info: 70 events, two pages
		await flush();
		await flush();
		const view = await open();
		await settle();
		expect(value(view, `${IDS.SOURCE}info-events`), "the run's extent at info").toBe(String(EVENTS));
		expect(value(view, `${IDS.SOURCE}info-page`)).toBe("50");
		expect(value(view, `${IDS.SOURCE}info-resident`), "the whole run resident (the headless fallback renders every row)").toBe(`0..${EVENTS - 1}`);
		expect(value(view, `${IDS.SOURCE}info-held`)).toBe(String(EVENTS));
		expect(value(view, `${IDS.SOURCE}info-cursor`), "no cursor: the live edge, no row").toBe("");
		expect(value(view, `${IDS.SOURCE}info-state`)).toBe("loaded");
		expect(value(view, `${IDS.STORE}info-stored`), "the device store: every event of the last run at info").toBe(String(EVENTS));
		expect(value(view, `${IDS.STORE}info-extent`), "and the extent kept").toBe(String(EVENTS));
	});

	it("shows every change at once: a source made after it opened, the cursor's row in it, and the live stream by level", async () => {
		const view = await open();
		expect(text(view)).toContain("No events yet");
		expect(text(view), "what the live counts are measured from: the device's time when the view opened").toMatch(/Live stream since this view opened \(device time \d\d:\d\d:\d\d\.\d\d\d\)/);
		document.body.appendChild(document.createElement(SHU_TAG.MONITOR_COLUMN)); // a source made after this view opened
		await flush();
		await flush();
		expect(value(view, `${IDS.SOURCE}info-events`), "listed from the moment it exists").toBe(String(EVENTS));
		timeCursor.set(1010);
		await view.updateComplete;
		expect(value(view, IDS.CURSOR)).toBe("00:00:01.010");
		expect(value(view, `${IDS.SOURCE}info-cursor`), "the cursor at 1010 sits on row 10 (timestamp 1000 + 10), shown without waiting for the device").toBe("10");
		handle.emit(step(EVENTS)); // a live info event: the extent grows, the view follows at once
		handle.emit({ id: "noise", timestamp: 2000, kind: "log", level: "debug", message: "below every open view's level", run: "r1", idx: { debug: EVENTS } });
		await flush();
		await flush();
		expect(value(view, `${IDS.SOURCE}info-events`)).toBe(String(EVENTS + 1));
		expect(value(view, `${IDS.LIVE}info`), "the live stream by level: one at info").toBe("1");
		expect(value(view, `${IDS.LIVE}debug`), "and one at debug, which no open view retains").toBe("1");
	});
});
