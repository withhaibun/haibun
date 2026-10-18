// @vitest-environment jsdom
// The client cache view is THE reading of what the page holds of an actuality: each source's extent, the rows it holds and the
// cursor's row in it, the live stream by level, and the executions this device holds; every value under its own test
// id, so a feature reads what the page holds from here with the generic steps. It doesn't make a source of its own.
import { declareGraphSpec, declareRegistry, GRAPH_READ_STEPS } from "../../../test/catalog-fixture.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { ShuClientCacheColumn } from "./shu-client-cache-column.js";
import "../../components/shu-monitor-column.js";
import { SHU_TEST_IDS } from "../../../domains/test-ids.js";
import { setupShuTest, stepsShown, type TShuTestHandle } from "../../../test/setup.js";
import { ACTUALITY_DOMAIN_DEFINITIONS, actualityStore } from "../actuality-store.test-fake.js";
import { timeCursor } from "../../controllers/page-cell-controller.js";
import { currentExecution, deviceGraph, installGraph } from "../controllers/device-controller.js";
import { servedDatabase } from "../root.js";
import { GRAPH_BOUND } from "../adapters/quad-store.js";
import { graphActualitySource } from "../controllers/actuality-controller.js";
import { endPage } from "../../adapters/page-held.js";

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
		endPage();
		handle = setupShuTest({
			dispatch: () => {
				throw new ServerUnreachable("/rpc", new Error("the views read actuality's records"));
			},
		});
		// The execution being recorded, and an earlier one this device still holds, each named by the feature it ran.
		const store = actualityStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, step(EARLIER, 0, { stepText: "Feature: An earlier actuality", called: "Haibun.feature", generatedAtTime: iso(500) }));
		await store.upsertIndividual(SEQ_PATH_LABEL, step(RUN, 0, { stepText: "Feature: The actuality being recorded", called: "Haibun.feature" }));
		for (let i = 1; i < STEPS; i++) await store.upsertIndividual(SEQ_PATH_LABEL, step(RUN, i));
		installGraph(store);
	});
	afterEach(() => {
		handle.teardown();
		timeCursor.set(null);
		document.body.innerHTML = "";
	});

	/** A view reading actuality at info, which is what this view reports on: the source, not whoever opened it. The view
	 *  reads after the page reads actuality's steps. */
	const readingTheActuality = async (): Promise<void> => {
		declareGraphSpec({ types: [SEQ_PATH_LABEL] });
		await graphActualitySource("info", false).ready();
		await flush();
	};

	const open = async (): Promise<ShuClientCacheColumn> => {
		const view = new ShuClientCacheColumn();
		document.body.appendChild(view);
		await flush();
		return view;
	};
	const value = (view: ShuClientCacheColumn, id: string): string | undefined => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
	const text = (view: ShuClientCacheColumn): string => view.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";

	it("reports what it hasn't read as pending, never as absent", async () => {
		installGraph(actualityStore());
		const view = new ShuClientCacheColumn();
		document.body.appendChild(view);
		await view.updateComplete; // before what the device holds has been read once
		expect(text(view), "what this device holds has not been read yet, so the view doesn't make a claim about it").toContain("Waiting");
		expect(text(view)).not.toContain("This device doesn't hold an execution");
		await settle();
		expect(text(view), "read, and now empty").toContain("This device doesn't hold an execution");
	});

	it("doesn't list a source until a view has read actuality, and doesn't make one itself", async () => {
		const view = await open();
		expect(text(view)).toContain("A view hasn't read actuality yet");
		expect(value(view, IDS.CURSOR)).toBe("live edge");
		expect(value(view, IDS.REGISTRY), "a step list hasn't been requested in this page").toBe("pending");
	});

	it("reads a source's extent, the rows it holds and its state, each under its id", async () => {
		await readingTheActuality();
		const view = await open();
		await settle();
		expect(value(view, `${IDS.SOURCE}info-events`), "actuality's extent at info").toBe(String(STEPS));
		expect(value(view, `${IDS.SOURCE}info-cached`), "the window a reader is looking at").toBe(`0..${STEPS - 1}`);
		expect(value(view, `${IDS.SOURCE}info-cached-rows`)).toBe(String(STEPS));
		expect(value(view, `${IDS.SOURCE}info-cursor`), "the source doesn't have a cursor: it reads the live edge rather than a row").toBe("");
		expect(value(view, `${IDS.SOURCE}info-loaded`), "what the source is doing is its own id, so a reader waits for the state rather than for a cell about to change").toBe(
			"loaded",
		);
	});

	it("shows every change at once: a source made after it opened, the cursor's row in it, and the live stream by level", async () => {
		const view = await open();
		expect(text(view)).toContain("An event hasn't arrived since this view opened");
		expect(text(view), "what the live counts are measured from: the device's time when the view opened").toMatch(
			/Live stream since this view opened \(device time \d\d:\d\d:\d\d\.\d\d\d\)/,
		);
		await readingTheActuality(); // a source made after this view opened
		expect(value(view, `${IDS.SOURCE}info-events`), "listed from the moment it exists").toBe(String(STEPS));
		timeCursor.set(1010);
		await view.updateComplete;
		expect(value(view, IDS.CURSOR)).toContain("00:00:01.010");
		expect(value(view, `${IDS.SOURCE}info-cursor`), "the cursor at 1010 is on row 10, shown without waiting for the device").toBe("10");
		handle.emit({ id: "0.1", timestamp: 2000, kind: "log", level: "info", message: "actuality logs something" });
		handle.emit({ id: "0.2", timestamp: 2000, kind: "log", level: "debug", message: "below every open view's level" });
		await flush();
		expect(value(view, `${IDS.LIVE}info`), "the live stream by level: one at info").toBe("1");
		expect(value(view, `${IDS.LIVE}debug`), "and one at debug, which the open views don't show").toBe("1");
	});

	it("lists the executions this device holds and reads the one a reader chooses", async () => {
		await readingTheActuality();
		const view = await open();
		await settle();
		const row = (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${IDS.RUN}${EARLIER}"]`) as HTMLElement;
		expect(row, "the earlier execution is listed").not.toBeNull();
		expect(value(view, `${IDS.RUN}${RUN}-reading`), "the execution the sources read shows it").toBe("reading");
		(row.querySelector(`[data-testid="${IDS.RUN}${EARLIER}-read"]`) as HTMLButtonElement).click();
		await flush();
		await settle();
		expect(currentExecution(), "the reader's execution is the one being read").toBe(EARLIER);
		expect(value(view, `${IDS.RUN}${EARLIER}-reading`)).toBe("reading");
		expect(value(view, `${IDS.RUN}${EARLIER}-features`), "an execution is presented by what it ran").toBe("An earlier actuality");
	});

	it("every instant it reports is clickable: clicking one scrubs every view to that moment, and the live edge is one click away", async () => {
		await readingTheActuality();
		const view = await open();
		await settle();
		const button = (id: string): HTMLButtonElement | null => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"] button`);
		expect(button(`${IDS.SOURCE}info-first`), "actuality's first instant is a control").not.toBeNull();
		button(`${IDS.SOURCE}info-first`)?.click();
		expect(timeCursor.get(), "the first instant of the actuality being read, which is not the earlier one this device also holds").toBe(1000);
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

describe("the graph the device holds", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		endPage();
		handle = setupShuTest({
			dispatch: () => {
				throw new ServerUnreachable("/rpc", new Error("the view reads the device"));
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		document.body.innerHTML = "";
	});

	it("states how full each database's graph is, its bound, and how many quads it dropped to keep within it", async () => {
		// The site's declarations of an actuality's types, which state how the device's graph reads an actuality's records.
		declareRegistry(stepsShown(GRAPH_READ_STEPS, {}, buildConcernCatalog(mapDefinitionsToDomains(ACTUALITY_DOMAIN_DEFINITIONS))));
		const database = servedDatabase();
		await deviceGraph(database).setMany([{ subject: "c1", predicate: "content", object: "hello", namedGraph: "Comment", timestamp: 1 }]);
		const view = new ShuClientCacheColumn();
		document.body.appendChild(view);
		await new Promise((r) => setTimeout(r, 300));
		const value = (id: string): string | undefined => (view.shadowRoot as ShadowRoot).querySelector(`[data-testid="${id}"]`)?.textContent?.trim();
		expect(value(`${SHU_TEST_IDS.CLIENT_CACHE.GRAPH}${database}-held`)).toBe("1");
		expect(value(`${SHU_TEST_IDS.CLIENT_CACHE.GRAPH}${database}-bound`)).toBe(String(GRAPH_BOUND));
		expect(value(`${SHU_TEST_IDS.CLIENT_CACHE.GRAPH}${database}-dropped`)).toBe("0");
	});
});
