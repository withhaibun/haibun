// @vitest-environment jsdom
/**
 * A run carried in a page: what a standalone report embeds is filled into a memory-backed device store at boot, and the
 * run sources then read it exactly as they read a run cached from a server. A payload written to another rule is refused
 * rather than read wrongly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CACHE_SHAPE } from "./device-store.js";
import { hydrateClientCache, type TCachePayload } from "./hydrate.js";
import { deviceStore, eventRunSource, resetRunSources, currentRun } from "./run-source.js";
import { cachedGraphStore } from "../quads-snapshot.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { windowSizeSetting, DEFAULT_WINDOW_SIZE } from "../window-size-setting.js";

const RUN = "reported-run";
const events = Array.from({ length: 12 }, (_, i) => ({ id: `[0.${i}]`, timestamp: 2000 + i, kind: "log", level: "info", run: RUN, idx: { debug: i, trace: i, log: i, info: i } }));
const payload = (over: Partial<TCachePayload> = {}): TCachePayload => ({
	shape: CACHE_SHAPE,
	run: RUN,
	events,
	extents: { log: { total: 12, first: 2000, last: 2011 }, info: { total: 12, first: 2000, last: 2011 } },
	registry: { steps: [], domains: {}, concerns: { persisted: {} } },
	...over,
});

describe("a run carried in a page", () => {
	let handle: TShuTestHandle;
	beforeEach(() => {
		windowSizeSetting.set("50");
		// A page with no server: every request fails, as it does for a report opened from a file.
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("this page has no server");
			},
		});
	});
	afterEach(() => {
		handle.teardown();
		resetRunSources();
		windowSizeSetting.set(DEFAULT_WINDOW_SIZE);
	});

	it("is read through the same sources as a run cached from a server", async () => {
		await hydrateClientCache(payload());
		const source = eventRunSource("info");
		await source.ready();
		expect(source.count(), "the run's extent, from what the page carries").toBe(12);
		await source.ensureRange(0, 12);
		expect((source.rowAt(0) as { id: string }).id).toBe("[0.0]");
		expect((source.rowAt(11) as { id: string }).id).toBe("[0.11]");
		expect(source.unavailable, "nothing is missing, so nothing is reported unavailable").toBeNull();
		expect(currentRun(), "the run the page carries is the run being read").toBe(RUN);
	});

	it("carries the registry, so the page knows the site's declarations with no server to ask", async () => {
		await hydrateClientCache(payload());
		expect((await deviceStore().registry())?.response).toEqual({ steps: [], domains: {}, concerns: { persisted: {} } });
	});

	it("refuses a payload written to another rule rather than reading it wrongly", async () => {
		await expect(hydrateClientCache(payload({ shape: "some-earlier-rule/0" }))).rejects.toThrow(/does not read/);
	});

	it("carries the graph, in a store of the page's own rather than the origin's", async () => {
		const quads = [
			{ subject: "c1", predicate: "content", object: "hello", namedGraph: "Comment", timestamp: 1 },
			{ subject: "c1", predicate: "author", object: "did:example:a", namedGraph: "Comment", timestamp: 2 },
		];
		await hydrateClientCache(payload({ quads }));
		expect((await cachedGraphStore().query({ subject: "c1" })).length, "the graph the page carries is what the graph views read").toBe(2);
		expect(await cachedGraphStore().get("c1", "content", "Comment")).toBe("hello");
	});
});
