// @vitest-environment jsdom
// A view reads the run through the records it wrote. A step is one row carrying how it went and how long it took,
// where a stream of occurrences said those separately and a view had to pair them up; what a step said is its own row.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { setGraphStore } from "../quads-snapshot.js";
import { setSiteMetadata, type SiteMetadata } from "../rels-cache.js";
import { setupShuTest, type TShuTestHandle } from "../test-setup.js";
import { graphRunSource, resetGraphRunSources } from "./graph-run-source.js";

const iso = (n: number): string => new Date(n).toISOString();
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";

describe("the run a view reads, over the records it wrote", () => {
	let handle: TShuTestHandle;
	let store: QuadStore;
	beforeEach(async () => {
		delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY];
		resetGraphRunSources();
		handle = setupShuTest({
			dispatch: () => {
				throw new Error("this test reads the records, not a server");
			},
		});
		setSiteMetadata({ types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL], rels: { [SEQ_PATH_LABEL]: {}, [LOG_MESSAGE_LABEL]: {}, [RUN_ARTIFACT_LABEL]: {} }, edgeRanges: {} } as unknown as SiteMetadata);
		store = new QuadStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: "0.1", stepText: "a step", actionStatus: "passed", generatedAtTime: iso(1000), endedAtTime: iso(1300) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: "0.1@said", message: "it said this", level: "warn", generatedAtTime: iso(1100), isPartOf: "0.1" });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { id: "0.1@detail", message: "the detail of it", level: "debug", generatedAtTime: iso(1200), isPartOf: "0.1" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { id: "0.2", stepText: "another step", actionStatus: "failed", generatedAtTime: iso(1400), endedAtTime: iso(1500) });
		setGraphStore(store);
	});
	afterEach(() => handle.teardown());

	it("gives a step one row, carrying how it went and how long it took", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.count()).toBe(4);
		expect(source.rowAt(0)).toMatchObject({ id: "0.1", kind: "lifecycle", type: "step", in: "a step", status: "passed", timestamp: 1000, endedAt: 1300, durationMs: 300 });
		expect(source.rowAt(1)).toMatchObject({ id: "0.1", kind: "log", level: "warn", message: "it said this", timestamp: 1100 });
		expect(source.rowAt(3)).toMatchObject({ id: "0.2", status: "failed" });
	});

	it("says what the run spans, so a view places its rows in time", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.extent()).toMatchObject({ total: 4, first: 1000, last: 1400 });
	});

	it("holds the levels at or above the one asked for, and nothing under it", async () => {
		const source = graphRunSource("info");
		await source.ready();
		expect(source.count(), "the two steps and the warning, and not the detail under info").toBe(3);
	});

	it("moves to a moment, so a reader reads a run far from its newest records", async () => {
		const source = graphRunSource("debug", { size: 2 });
		await source.ready();
		expect(source.count()).toBe(2);
		await source.readAt(1000);
		expect(source.rowAt(0)).toMatchObject({ timestamp: 1000 });
	});

	it("says every row it holds is readable, so a view marks and scrolls without asking for more", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.cachedRanges()).toEqual([{ from: 0, to: 4 }]);
		expect(source.loaded).toBe(true);
		expect(source.unavailable).toBeNull();
	});
});
