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
import { readRunAt, runReadingAt } from "./run-source.js";
import { timeCursor } from "../signals.js";

const iso = (n: number): string => new Date(n).toISOString();
const STORE_KEY = "__SHU_QUADS_SNAPSHOT_STORE__";
const RUN = "1700000000000-1";

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
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.1`, stepText: "a step", actionStatus: "passed", level: "info", generatedAtTime: iso(1000), endedAtTime: iso(1300), recordedAtTime: iso(1300) });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { execution: RUN, id: `${RUN}.0.1@0`, message: "it said this", level: "warn", generatedAtTime: iso(1100), recordedAtTime: iso(1100), isPartOf: `${RUN}.0.1` });
		await store.upsertIndividual(LOG_MESSAGE_LABEL, { execution: RUN, id: `${RUN}.0.1@1`, message: "the detail of it", level: "debug", generatedAtTime: iso(1200), recordedAtTime: iso(1200), isPartOf: `${RUN}.0.1` });
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.2`, stepText: "another step", actionStatus: "failed", level: "info", generatedAtTime: iso(1400), endedAtTime: iso(1500), recordedAtTime: iso(1500) });
		setGraphStore(store);
	});
	afterEach(() => handle.teardown());

	it("gives a step one row, carrying how it went and how long it took", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.count()).toBe(4);
		expect(source.rowAt(0)).toMatchObject({ id: `${RUN}.0.1`, kind: "lifecycle", type: "step", in: "a step", status: "passed", timestamp: 1000, endedAt: 1300, durationMs: 300 });
		expect(source.rowAt(1), "a statement is shown under the step it was said during, which is what names its row").toMatchObject({ id: `${RUN}.0.1`, kind: "log", level: "warn", message: "it said this", timestamp: 1100 });
		expect(source.rowAt(3)).toMatchObject({ id: `${RUN}.0.2`, status: "failed" });
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

	it("reads every source at the moment the run is read around, and follows the newest records again when none is named", async () => {
		const info = graphRunSource("info", { size: 2 });
		const debug = graphRunSource("debug", { size: 2 });
		await Promise.all([info.ready(), debug.ready()]);
		await readRunAt(1000);
		expect(runReadingAt(), "the moment is the page's, so every view of the run reads the same one").toBe(1000);
		expect(info.rowAt(0)).toMatchObject({ timestamp: 1000 });
		expect(debug.rowAt(0)).toMatchObject({ timestamp: 1000 });
		await readRunAt(null);
		expect(runReadingAt()).toBeUndefined();
		expect(debug.rowAt(1), "the newest records the run holds").toMatchObject({ timestamp: 1400 });
	});

	it("makes a source at the moment the run is read around, so a view opened while a reader reads the past reads it too", async () => {
		await readRunAt(1000);
		const source = graphRunSource("debug", { size: 2 });
		await source.ready();
		expect(source.rowAt(0), "where the reader is, rather than the newest records").toMatchObject({ timestamp: 1000 });
	});

	it("reads a run past the window at the window's size, wherever in it the reader is", async () => {
		// A run of more records than a window holds is the case the window exists for: what it costs to read must be the
		// window's size and not the run's, and where a reader moves must be read rather than assumed to be held already.
		const PAST_THE_WINDOW = 600;
		const size = 50;
		const began = 10000;
		const each = 1000;
		for (let i = 0; i < PAST_THE_WINDOW; i++) {
			await store.upsertIndividual(LOG_MESSAGE_LABEL, { execution: RUN, id: `${RUN}.1.${i}@0`, message: `record ${i}`, level: "info", generatedAtTime: iso(began + i * each), recordedAtTime: iso(began + i * each), isPartOf: `${RUN}.0.1` });
		}
		const source = graphRunSource("info", { size });
		await source.ready();
		expect(source.count(), "the newest of the run, at the window's size").toBe(size);
		const early = began + 100 * each;
		await readRunAt(early);
		const times = Array.from({ length: source.count() }, (_, i) => (source.rowAt(i) as { timestamp: number }).timestamp);
		expect(times.length, "still the window's size, however far from the newest records the reader moved").toBe(size);
		expect(Math.min(...times)).toBeGreaterThan(began);
		expect(Math.max(...times)).toBeLessThan(began + (PAST_THE_WINDOW - 1) * each);
		expect(times.some((t) => Math.abs(t - early) < size * each), "the records around where the reader is").toBe(true);
		await readRunAt(early + each);
		const after = Array.from({ length: source.count() }, (_, i) => (source.rowAt(i) as { timestamp: number }).timestamp);
		expect(after, "a moment the window already holds is read from the window rather than read again").toEqual(times);
	});


	it("adds what has happened since it last read, rather than reading the run again", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.count()).toBe(4);
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.3`, stepText: "a later step", actionStatus: "passed", level: "info", generatedAtTime: iso(1600), recordedAtTime: iso(1600) });
		const first = source.rowAt(0);
		await source.readAt(undefined);
		await new Promise((r) => setTimeout(r, 0));
		expect(source.count(), "the run it held, and what happened since").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a later step" });
		expect(source.rowAt(0), "a row it already held is the same row").toBe(first);
	});


	it("stops reading a run nothing is showing, and reads afresh for the next view", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		const held = source.count();
		expect(held, "the run it read").toBeGreaterThan(0);
		const release = source.subscribe(() => undefined);
		release();
		// A source nothing holds is reading a run nobody is shown. The next view at this level is given a new one.
		const next = graphRunSource("debug");
		expect(next, "a source nothing held was let go rather than left reading").not.toBe(source);
		await next.ready();
		expect(next.count(), "and the run reads the same either way").toBe(held);
	});

	it("reads a step again while it is still running, so its row says how it went once it ends", async () => {
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.3`, stepText: "a running step", actionStatus: "running", level: "info", generatedAtTime: iso(1700), recordedAtTime: iso(1700) });
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.rowAt(4)).toMatchObject({ in: "a running step", status: "running" });
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.3`, stepText: "a running step", actionStatus: "passed", level: "info", generatedAtTime: iso(1700), endedAtTime: iso(1800), recordedAtTime: iso(1800) });
		await source.readAt(undefined);
		await new Promise((r) => setTimeout(r, 0));
		expect(source.count(), "the step it already held, now ended, rather than a second row for it").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a running step", status: "passed", endedAt: 1800 });
	});

	it("reads again when the stream comes back, since what was recorded while it was down arrived in no batch", async () => {
		const source = graphRunSource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.count()).toBe(4);
		await store.upsertIndividual(SEQ_PATH_LABEL, { execution: RUN, id: `${RUN}.0.3`, stepText: "a step nobody was told about", actionStatus: "passed", level: "info", generatedAtTime: iso(1600), recordedAtTime: iso(1600) });
		handle.eventStream.reconnect();
		await new Promise((r) => setTimeout(r, 5));
		expect(source.count(), "the run it held, and what happened while it was not being told").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a step nobody was told about" });
	});

	it("is behind an announcement until it has read for it, and current once it has", async () => {
		const source = graphRunSource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.behind, "read once and nothing announced since").toBe(false);
		handle.eventStream.emit({ level: "info", kind: "log", message: "something the run said", timestamp: 1600 } as never);
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		expect(source.behind, "announced, and the read for it has not finished").toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(source.behind, "the read the announcement scheduled has finished").toBe(false);
	});

	it("says it is cut off while the stream is down, and behind from the stream's return until it has read again", async () => {
		const source = graphRunSource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.disconnected).toBe(false);
		handle.eventStream.disconnect();
		expect(source.disconnected, "what the run does now reaches this page no more").toBe(true);
		handle.eventStream.reconnect();
		expect(source.disconnected).toBe(false);
		expect(source.behind, "the stream coming back says there may be something to read again for").toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(source.behind, "read again since the stream came back").toBe(false);
	});

	it("knows the stream is down when made after it broke, rather than believing it is current", async () => {
		handle.eventStream.disconnect();
		const source = graphRunSource("info");
		await source.ready();
		expect(source.disconnected).toBe(true);
	});

	it("says every row it holds is readable, so a view marks and scrolls without asking for more", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		expect(source.cachedRanges()).toEqual([{ from: 0, to: 4 }]);
		expect(source.loaded).toBe(true);
		expect(source.unavailable).toBeNull();
	});
});

describe("the rail the run's rows sit on", () => {
	it("carries the whole run, so a place on it names a moment the window does not hold", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		const rail = source.rail;
		expect(rail, "a run source states the rail its rows sit on").toBeDefined();
		expect(rail?.places).toBeGreaterThan(1);
		const first = rail?.placeOf(0) ?? -1;
		const last = rail?.placeOf(source.count() - 1) ?? -1;
		expect(first).toBeGreaterThanOrEqual(0);
		expect(last).toBeGreaterThanOrEqual(first);
	});

	it("marks what the run holds, counted rather than read, so a rail of any length costs the same", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		const marks = source.rail?.marks() ?? [];
		expect(marks.length, "the run's divisions that hold something").toBeGreaterThan(0);
		for (const mark of marks) {
			expect(mark.index).toBeGreaterThanOrEqual(0);
			expect(mark.index).toBeLessThan(source.rail?.places ?? 0);
		}
	});

	it("reads the run around the moment a press names, and says so through the shared cursor", async () => {
		const source = graphRunSource("debug");
		await source.ready();
		source.rail?.goTo(0);
		expect(timeCursor.get(), "the earliest place names the run's first moment, which is not the live edge").not.toBeNull();
	});
});
