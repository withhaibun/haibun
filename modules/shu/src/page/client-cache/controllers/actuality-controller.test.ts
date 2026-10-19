// @vitest-environment jsdom
// A view reads actuality through the records it wrote. A step is one row carrying how it went and how long it took,
// where a stream of occurrences logged those separately and a view had to pair them up; what a step logged is its own row.
import { declareGraphSpec } from "../../../test/catalog-fixture.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { QuadStore } from "@haibun/core/lib/quad-store.js";
import { LOG_MESSAGE_LABEL } from "@haibun/core/lib/domains/log-message.js";
import { RUN_ARTIFACT_LABEL } from "@haibun/core/lib/domains/run-artifact.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import type { THaibunLogLevel } from "@haibun/core/lib/domains/protocol.js";
import { clearStoredFields, setupShuTest, storeFields, type TShuTestHandle } from "../../../test/setup.js";
import { SHU_TAG } from "../../../domains/elements.js";
import { PAGE_SETTING_KEY } from "../../domains/settings.js";
import "../../components/shu-window-size.js";
import { actualityStore } from "../actuality-store.test-fake.js";
import { ServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { installGraph } from "./device-controller.js";
import { graphActualitySource as readingAt, readActualityAt, ActualityController, actualityReadingAt, actualitySourceScope, type ActualitySource } from "./actuality-controller.js";
import { makeGraphActualitySource, type TGraphActualitySource } from "../pipelines/actuality-sources.js";
import { ACTUALITY_WINDOW_SIZE } from "../derivations/actuality-rows.js";
import { timeCursor } from "../../root.js";
import { endPage } from "../../adapters/page-held.js";

const iso = (n: number): string => new Date(n).toISOString();
const RUN = "1700000000000-1";

/** The readings made with a size or a delay of their own, which the page doesn't hold, so each case closes them. */
const made: TGraphActualitySource[] = [];

/** A reading of actuality at `level`: the page's, or one of its own size and delay before it reads again. */
function graphActualitySource(level: THaibunLogLevel, own?: { size?: number; reReadAfterMs?: number }): ActualitySource {
	if (own === undefined) return readingAt(level, false);
	const source = makeGraphActualitySource(actualitySourceScope(), level, {
		size: own.size ?? ACTUALITY_WINDOW_SIZE,
		reReadAfterMs: own.reReadAfterMs ?? 250,
		substeps: false,
		release: () => undefined,
	});
	made.push(source);
	return source;
}

describe("the actuality a view reads, over the records it wrote", () => {
	let handle: TShuTestHandle;
	let store: QuadStore;
	beforeEach(async () => {
		endPage();
		// A server doesn't respond: the page reads the records it holds.
		handle = setupShuTest({
			dispatch: (method) => {
				throw new ServerUnreachable(`/rpc/${method}`, new Error("this test reads the records, not a server"));
			},
		});
		declareGraphSpec({ types: [SEQ_PATH_LABEL, LOG_MESSAGE_LABEL, RUN_ARTIFACT_LABEL] });
		store = actualityStore();
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.1`,
			stepText: "a step",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1000),
			endedAtTime: iso(1300),
			recordedAtTime: iso(1300),
		});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			execution: RUN,
			id: `${RUN}.0.1@0`,
			message: "it said this",
			level: "warn",
			generatedAtTime: iso(1100),
			recordedAtTime: iso(1100),
			isPartOf: `${RUN}.0.1`,
		});
		await store.upsertIndividual(LOG_MESSAGE_LABEL, {
			execution: RUN,
			id: `${RUN}.0.1@1`,
			message: "the detail of it",
			level: "debug",
			generatedAtTime: iso(1200),
			recordedAtTime: iso(1200),
			isPartOf: `${RUN}.0.1`,
		});
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.2`,
			stepText: "another step",
			actionStatus: "failed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1400),
			endedAtTime: iso(1500),
			recordedAtTime: iso(1500),
		});
		installGraph(store);
	});
	afterEach(() => {
		for (const source of made.splice(0)) source.close();
		handle.teardown();
	});

	it("gives a step one row, carrying how it went and how long it took", async () => {
		const source = graphActualitySource("debug");
		await source.ready();
		expect(source.count()).toBe(4);
		expect(source.rowAt(0)).toMatchObject({
			id: `${RUN}.0.1`,
			kind: "lifecycle",
			type: "step",
			in: "a step",
			status: "passed",
			timestamp: 1000,
			endedAt: 1300,
			line: expect.objectContaining({ tookMs: 300 }),
		});
		expect(source.rowAt(1), "a statement is shown under the step it was logged during, which is what names its row").toMatchObject({
			id: `${RUN}.0.1`,
			kind: "log",
			level: "warn",
			message: "it said this",
			timestamp: 1100,
		});
		expect(source.rowAt(3)).toMatchObject({ id: `${RUN}.0.2`, status: "failed" });
	});

	it("pages by the window size <shu-window-size> stored, and by the initial size where it didn't store one", async () => {
		// A source is read once per level on a page, so each read names another level.
		clearStoredFields(SHU_TAG.WINDOW_SIZE);
		expect(graphActualitySource("warn").pageSize).toBe(500);
		const picker = document.createElement(SHU_TAG.WINDOW_SIZE);
		document.body.appendChild(picker);
		await (picker as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
		picker.shadowRoot?.querySelector<HTMLButtonElement>('button[data-value="2000"]')?.click();
		expect(graphActualitySource("error").pageSize).toBe(2000);
		picker.remove();
		storeFields(SHU_TAG.WINDOW_SIZE, PAGE_SETTING_KEY, { rows: "50" });
		expect(graphActualitySource("trace").pageSize, "a size stored on an earlier page").toBe(50);
		clearStoredFields(SHU_TAG.WINDOW_SIZE);
	});

	it("reports what actuality spans, so a view places its rows in time", async () => {
		const source = graphActualitySource("debug");
		await source.ready();
		expect(source.extent()).toMatchObject({ total: 4, first: 1000, last: 1400 });
	});

	it("holds the levels at or above the one requested, and doesn't hold a level under it", async () => {
		const source = graphActualitySource("info");
		await source.ready();
		expect(source.count(), "the two steps and the warning, and not the detail under info").toBe(3);
	});

	it("moves to a moment, so a reader reads an actuality far from its newest records", async () => {
		const source = graphActualitySource("debug", { size: 2 });
		await source.ready();
		expect(source.count()).toBe(2);
		await source.readAt(1000);
		expect(source.rowAt(0)).toMatchObject({ timestamp: 1000 });
	});

	it("reads every source at the moment actuality is read around, and follows the newest records again when a moment isn't named", async () => {
		const info = graphActualitySource("info", { size: 2 });
		const debug = graphActualitySource("debug", { size: 2 });
		await Promise.all([info.ready(), debug.ready()]);
		await readActualityAt(1000);
		expect(actualityReadingAt(), "the moment is the page's, so every view of actuality reads the same one").toBe(1000);
		expect(info.rowAt(0)).toMatchObject({ timestamp: 1000 });
		expect(debug.rowAt(0)).toMatchObject({ timestamp: 1000 });
		await readActualityAt(null);
		expect(actualityReadingAt()).toBeUndefined();
		expect(debug.rowAt(1), "the newest records actuality holds").toMatchObject({ timestamp: 1400 });
	});

	it("makes a source at the moment actuality is read around, so a view opened while a reader reads the past reads it too", async () => {
		await readActualityAt(1000);
		const source = graphActualitySource("debug", { size: 2 });
		await source.ready();
		expect(source.rowAt(0), "where the reader is, rather than the newest records").toMatchObject({ timestamp: 1000 });
	});

	it("reads an actuality past the window at the window's size, wherever in it the reader is", async () => {
		// An actuality of more records than a window holds is the case the window exists for: what it takes to read must be the
		// window's size and not actuality's, and where a reader moves must be read rather than assumed to be held already.
		const PAST_THE_WINDOW = 600;
		const size = 50;
		const began = 10000;
		const each = 1000;
		for (let i = 0; i < PAST_THE_WINDOW; i++) {
			await store.upsertIndividual(LOG_MESSAGE_LABEL, {
				execution: RUN,
				id: `${RUN}.1.${i}@0`,
				message: `record ${i}`,
				level: "info",
				generatedAtTime: iso(began + i * each),
				recordedAtTime: iso(began + i * each),
				isPartOf: `${RUN}.0.1`,
			});
		}
		const source = graphActualitySource("info", { size });
		await source.ready();
		expect(source.count(), "the newest of actuality, at the window's size").toBe(size);
		const early = began + 100 * each;
		await readActualityAt(early);
		const times = Array.from({ length: source.count() }, (_, i) => (source.rowAt(i) as { timestamp: number }).timestamp);
		expect(times.length, "still the window's size, however far from the newest records the reader moved").toBe(size);
		expect(Math.min(...times)).toBeGreaterThan(began);
		expect(Math.max(...times)).toBeLessThan(began + (PAST_THE_WINDOW - 1) * each);
		expect(
			times.some((t) => Math.abs(t - early) < size * each),
			"the records around where the reader is",
		).toBe(true);
		await readActualityAt(early + each);
		const after = Array.from({ length: source.count() }, (_, i) => (source.rowAt(i) as { timestamp: number }).timestamp);
		expect(after, "a moment the window already holds is read from the window rather than read again").toEqual(times);
	});

	it("adds what has happened since it last read, rather than reading actuality again", async () => {
		const source = graphActualitySource("debug");
		await source.ready();
		expect(source.count()).toBe(4);
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.3`,
			stepText: "a later step",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1600),
			recordedAtTime: iso(1600),
		});
		const first = source.rowAt(0);
		await source.readAt(undefined);
		await new Promise((r) => setTimeout(r, 0));
		expect(source.count(), "the actuality it held, and what happened since").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a later step" });
		expect(source.rowAt(0), "a row it already held is the same row").toBe(first);
	});

	it("stops reading an actuality that a view isn't showing, and reads afresh for the next view", async () => {
		const source = graphActualitySource("debug");
		await source.ready();
		const held = source.count();
		expect(held, "the actuality it read").toBeGreaterThan(0);
		const release = source.subscribe(() => undefined);
		release();
		// A source that a view doesn't hold is reading an actuality that a reader isn't shown. The next view at this level is given a new one.
		const next = graphActualitySource("debug");
		expect(next, "a source that a view didn't hold was let go rather than left reading").not.toBe(source);
		await next.ready();
		expect(next.count(), "and actuality reads the same either way").toBe(held);
	});

	it("reads a step again while it is still running, so its row shows how it went once it ends", async () => {
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.3`,
			stepText: "a running step",
			actionStatus: "running",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1700),
			recordedAtTime: iso(1700),
		});
		const source = graphActualitySource("debug");
		await source.ready();
		expect(source.rowAt(4)).toMatchObject({ in: "a running step", status: "running" });
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.3`,
			stepText: "a running step",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1700),
			endedAtTime: iso(1800),
			recordedAtTime: iso(1800),
		});
		await source.readAt(undefined);
		await new Promise((r) => setTimeout(r, 0));
		expect(source.count(), "the step it already held, now ended, rather than a second row for it").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a running step", status: "passed", endedAt: 1800 });
	});

	it("reads again when the stream comes back, since what was recorded while it was down didn't arrive in a batch", async () => {
		const source = graphActualitySource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.count()).toBe(4);
		await store.upsertIndividual(SEQ_PATH_LABEL, {
			execution: RUN,
			id: `${RUN}.0.3`,
			stepText: "a step nobody was told about",
			actionStatus: "passed",
			accessLevel: "private",
			level: "info",
			generatedAtTime: iso(1600),
			recordedAtTime: iso(1600),
		});
		handle.eventStream.disconnect();
		handle.eventStream.reconnect();
		await new Promise((r) => setTimeout(r, 5));
		expect(source.count(), "the actuality it held, and what happened while the stream was down").toBe(5);
		expect(source.rowAt(4)).toMatchObject({ in: "a step nobody was told about" });
	});

	it("is behind an announcement until it has read for it, and current once it has", async () => {
		const source = graphActualitySource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.behind, "read once and a record hasn't been announced since").toBe(false);
		handle.eventStream.emit({ level: "info", kind: "log", message: "a message actuality logged", timestamp: 1600 } as never);
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		expect(source.behind, "announced, and the read for it has not finished").toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(source.behind, "the read the announcement scheduled has finished").toBe(false);
	});

	it("is ended once the stream carries its execution's end, as the actuality machine holds it", async () => {
		const source = graphActualitySource("debug", { reReadAfterMs: 0 });
		await source.ready();
		const lifecycle = (type: string, stage: string, id: string, status: string) => ({ level: "info", kind: "lifecycle", type, stage, id, status, timestamp: 1600 }) as never;
		handle.eventStream.emit(lifecycle("execution", "start", "execution-start", "running"));
		handle.eventStream.emit(lifecycle("feature", "start", "feat-1", "running"));
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		expect(source.ended, "the execution has started and hasn't ended").toBe(false);
		handle.eventStream.emit(lifecycle("feature", "end", "feat-1", "completed"));
		handle.eventStream.emit(lifecycle("execution", "end", "execution-end", "completed"));
		await new Promise((r) => requestAnimationFrame(() => r(undefined)));
		expect(source.ended, "the execution's end moved the machine to completed").toBe(true);
	});

	it("reports it is cut off while the stream is down, and behind from the stream's return until it has read again", async () => {
		const source = graphActualitySource("debug", { reReadAfterMs: 0 });
		await source.ready();
		expect(source.disconnected).toBe(false);
		handle.eventStream.disconnect();
		expect(source.disconnected, "what actuality does now no longer reaches this page").toBe(true);
		handle.eventStream.reconnect();
		expect(source.disconnected).toBe(false);
		expect(source.behind, "the stream coming back reports there may be something to read again for").toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(source.behind, "read again since the stream came back").toBe(false);
	});

	it("states the stream is down when made after it broke, rather than reading as current", async () => {
		handle.eventStream.disconnect();
		const source = graphActualitySource("info");
		await source.ready();
		expect(source.disconnected).toBe(true);
	});

	it("reports every row it holds is readable, so a view marks and scrolls without reading more", async () => {
		const source = graphActualitySource("debug");
		await source.ready();
		expect(source.cachedRanges()).toEqual([{ from: 0, to: 4 }]);
		expect(source.loaded).toBe(true);
		expect(source.unavailable).toBeNull();
	});

	describe("the rail of actuality's rows", () => {
		it("carries all of the execution, so a place on it names a moment the window does not hold", async () => {
			const source = graphActualitySource("debug");
			await source.ready();
			const rail = source.rail;
			expect(rail, "an actuality source states the rail of its rows").toBeDefined();
			expect(rail?.places).toBeGreaterThan(1);
			const first = rail?.placeOf(0) ?? -1;
			const last = rail?.placeOf(source.count() - 1) ?? -1;
			expect(first).toBeGreaterThanOrEqual(0);
			expect(last).toBeGreaterThanOrEqual(first);
		});

		it("marks what actuality holds, counted rather than read, so a rail of any length takes the same", async () => {
			const source = graphActualitySource("debug");
			await source.ready();
			const marks = source.rail?.marks() ?? [];
			expect(marks.length, "actuality's divisions that hold something").toBeGreaterThan(0);
			for (const mark of marks) {
				expect(mark.index).toBeGreaterThanOrEqual(0);
				expect(mark.index).toBeLessThan(source.rail?.places ?? 0);
			}
		});

		it("reads actuality around the moment a press names, and states so through the shared cursor", async () => {
			const source = graphActualitySource("debug");
			await source.ready();
			source.rail?.goTo(0);
			expect(timeCursor.get(), "the earliest place names actuality's first moment, which is not the live edge").not.toBeNull();
		});
	});

	describe("a view's reading", () => {
		/** A host that renders on request, as a view does, and counts its renders. */
		const host = () => {
			const controllers: Array<{ hostDisconnected?: () => void }> = [];
			return {
				renders: 0,
				controllers,
				addController: (c: { hostDisconnected?: () => void }) => controllers.push(c),
				requestUpdate() {
					this.renders += 1;
				},
				removeController: () => undefined,
				updateComplete: Promise.resolve(true),
			};
		};

		it("derives the view's window once per change of the reading, so 1,000 moves of the time cursor cause 0 rebuilds", async () => {
			const view = host();
			let rebuilds = 0;
			const runs = new ActualityController(view, (run) => {
				rebuilds += 1;
				return run.count();
			});
			const source = runs.read("debug", false);
			await source.ready();
			expect(runs.derived).toBe(4);
			const built = rebuilds;
			for (let move = 0; move < 1000; move++) {
				timeCursor.set(1000 + move);
				expect(runs.derived).toBe(4);
			}
			expect(rebuilds - built, "a move of the cursor reads the window held").toBe(0);
			await source.readAt(1000);
			expect(runs.derived, "a change of the reading derives again").toBe(source.count());
			expect(rebuilds - built).toBe(1);
			timeCursor.set(null);
		});

		it("lets the reading go when the view disconnects", async () => {
			const view = host();
			const runs = new ActualityController(view, (run) => run.count());
			const source = runs.read("debug", false);
			await source.ready();
			for (const controller of view.controllers) controller.hostDisconnected?.();
			expect(readingAt("debug", false), "a reading that every view let go is dropped, and the next view reads afresh").not.toBe(source);
		});
	});
});
