/**
 * The run a view reads, over the records the run wrote.
 *
 * A run is in the graph: a step is a `SeqPath` individual, what it said and what it produced point back at it. This
 * serves a view the window of that run a reader is looking at, through the same interface a view already reads a run
 * by, so what changes is where the rows come from rather than how a view asks for them.
 *
 * A step is one row. It began, it ended and it says how it went, all on one record, where a stream of occurrences had
 * to say those separately and a view had to pair them up again.
 *
 * The window re-reads when the run says something changed, and a view following the newest asks only for what has
 * happened since it last read. A view therefore holds what a reader is looking at rather than everything that has
 * happened, and following costs what has changed rather than what the run holds, which is what keeps a run of years
 * readable.
 */
import { HAIBUN_LOG_LEVELS, declaredName, declaresFeature, declaresScenario, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { getWindowSize } from "../window-size-setting.js";
import { pagePinned } from "../page-pinned.js";
import { cachedGraphStore } from "../quads-snapshot.js";
import { individualAsQuads } from "./quad-store.js";
import { currentExecution, noteExecution, subscribeExecutionSwitch } from "./executions.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import type { Range } from "../ranges.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { RUN_WINDOW_SIZE, inRunOrder, runWindow, type TRunRow } from "./run-window.js";
import { noteRunSpan, readingBy, type RunSource, type TEventRecord, type TRunExtent } from "./run-source.js";

/** How long a burst of changes is collected before the window is read again. */
export const RE_READ_AFTER_MS = 250;

/** What a step declared, where it declared one: a feature or a scenario is the step that named it, and a view titles it
 *  by the name that step carries rather than by a second announcement of the same thing. */
function declared(row: TRunRow): Record<string, unknown> {
	if (declaresFeature(row.called)) return { type: "feature", featureName: declaredName(row.text, "feature") };
	if (declaresScenario(row.called)) return { type: "scenario", scenarioName: declaredName(row.text, "scenario") };
	return { type: "step" };
}

/** A row as a view renders it. A step carries how it went and how long it took; what was said carries its own level. */
function asRendered(row: TRunRow): TEventRecord {
	// The step path a view shows and navigates by is the path within the execution: the execution is how records of
	// different runs are told apart, not something a reader of one run is shown on every row.
	const seqPath = row.under?.length ? row.under : undefined;
	if (row.kind === "said") return { id: row.step, kind: "log", level: row.level, message: row.text, timestamp: row.at, seqPath };
	// A produced thing is claimed by the step it came from, which a document reads from the identity it carries.
	if (row.kind === "produced")
		return {
			id: row.id,
			kind: "artifact",
			artifactType: row.artifactType,
			level: row.level,
			timestamp: row.at,
			...(row.path === undefined ? {} : { path: row.path }),
			...(row.featureRelativePath === undefined ? {} : { featureRelativePath: row.featureRelativePath }),
			...(row.mediaType === undefined ? {} : { mimetype: row.mediaType }),
			seqPath,
		};
	return {
		id: row.step,
		kind: "lifecycle",
		...declared(row),
		level: row.level,
		// What was asked for, and what ran: a view shows the step's own words and says which action carried them out.
		in: row.text,
		...(row.called === undefined ? {} : { called: row.called, actionName: row.called }),
		status: row.status,
		...(row.error === undefined ? {} : { error: row.error }),
		...(row.showed === undefined ? {} : { showed: row.showed }),
		timestamp: row.at,
		...(row.endedAt === undefined ? {} : { endedAt: row.endedAt, durationMs: row.endedAt - row.at }),
		...(row.ranVia === undefined ? {} : { ranVia: row.ranVia }),
		...(row.ranOn === undefined ? {} : { ranOn: row.ranOn }),
		...(row.capabilityAction === undefined ? {} : { capabilityAction: row.capabilityAction }),
		...(row.allowedAction === undefined ? {} : { allowedAction: row.allowedAction }),
		...(row.performedBy === undefined ? {} : { performedBy: row.performedBy }),
		seqPath,
	};
}

/** The run as a view reads it, at one level. `at` moves the window; absent, it follows the newest records. */
/** The sources a page reads by, one per level: every view at a level reads the same window, so a level is read once
 *  however many views show it, and a view of what this page holds lists one source per level rather than one per view. */
const SOURCES_KEY = "__SHU_GRAPH_RUN_SOURCES__";
const sources = (): Map<string, TGraphRunSource> => pagePinned(SOURCES_KEY, () => new Map<string, TGraphRunSource>());

/** Test-only: forget the sources, so the next read makes them afresh. */
export function resetGraphRunSources(): void {
	for (const source of sources().values()) source.close();
	sources().clear();
}

export type TGraphRunSource = RunSource & { readAt(at?: number): Promise<void>; close(): void };

export function graphRunSource(level: THaibunLogLevel, options: { size?: number; reReadAfterMs?: number } = {}): TGraphRunSource {
	const held = sources().get(level);
	if (held) return held;
	const made = makeGraphRunSource(level, options);
	sources().set(level, made);
	return made;
}

function makeGraphRunSource(level: THaibunLogLevel, { size = RUN_WINDOW_SIZE, reReadAfterMs = RE_READ_AFTER_MS }: { size?: number; reReadAfterMs?: number }): TGraphRunSource {
	let rows: TEventRecord[] = [];
	let extent: TRunExtent = { total: 0 };
	let loaded = false;
	let at: number | undefined;
	let reading: Promise<void> | null = null;
	let due: ReturnType<typeof setTimeout> | null = null;
	const subs = new Set<() => void>();
	const notify = (): void => {
		for (const fn of subs) fn();
	};

	// A row a re-read finds again is the same row: a view holds its place, and what it built from that row, by the row
	// being the same object. Re-reading is how a window stays current, so re-reading must not look like every row changing.
	const held = new Map<string, TEventRecord>();
	const keyOf = (row: TRunRow): string => `${row.kind}|${row.step}|${row.at}|${row.text}|${row.status ?? ""}|${row.endedAt ?? ""}`;
	const same = (row: TRunRow): TEventRecord => {
		const key = keyOf(row);
		const carried = held.get(key);
		if (carried) return carried;
		const made = asRendered(row);
		held.set(key, made);
		return made;
	};
	/** Hold what a window read, in one write, and say where it could not be held rather than leaving a reader to find
	 *  it missing later. */
	const hold = (rows: TRunRow[]): Promise<void> => {
		if (rows.length === 0) return Promise.resolve();
		const quads = rows.flatMap((row) => individualAsQuads(row.label, row.record)[1]);
		return cachedGraphStore()
			.setMany(quads)
			.catch((err: unknown) => failFastOrLog("the run's records could not be held on this device", err));
	};

	/** The rows the window holds, oldest first, and what they span: what every view of this source reads. */
	let window: TRunRow[] = [];

	/**
	 * Read the run. Following the live edge, a view already holding rows asks only for what has changed since it last
	 * read: what has happened since its newest row, a step that ended since counting as that. Reading the whole window
	 * again to find a few new records is what makes following a long run cost what the run costs. Anywhere else, the
	 * window is read around where the reader is.
	 */
	const read = async (): Promise<void> => {
		const execution = currentExecution();
		const of = { size, minLevel: level, ...(execution === undefined ? {} : { execution }) };
		const following = at === undefined && window.length > 0;
		const answer = await runWindow(following ? { ...of, since: window[window.length - 1].at } : { ...of, ...(at === undefined ? {} : { at }) });
		if (following) {
			// A record read again replaces the one held under its name; one not held before is new. Either way the
			// window is what it held and what has changed, in the order the run put them.
			const byName = new Map(window.map((row) => [row.id, row]));
			const changed = answer.rows.filter((row) => byName.get(row.id) === undefined || keyOf(byName.get(row.id) as TRunRow) !== keyOf(row));
			if (changed.length === 0) return;
			for (const row of changed) byName.set(row.id, row);
			window = [...byName.values()].sort(inRunOrder).slice(-size);
		} else window = answer.rows;
		// What a page has read, it holds: the records are what a reader with no site to ask reads them back from, and
		// what makes an execution one this device can be brought back to. Only what is new to the window is written,
		// and every new record in one write, so reading a window costs one write rather than one per record.
		void hold(window.filter((row) => !held.has(keyOf(row))));
		rows = window.map(same);
		// What the window no longer holds is not held here either, so a window that moves does not grow this without bound.
		const shown = new Set(rows);
		for (const [key, row] of held) if (!shown.has(row)) held.delete(key);
		const newest = window[window.length - 1]?.name;
		if (newest) noteExecution(newest.execution);
		const from = window[0]?.at;
		const to = window[window.length - 1]?.at;
		extent = { total: rows.length, ...(from === undefined ? {} : { first: from }), ...(to === undefined ? {} : { last: to }) };
		loaded = true;
		noteRunSpan(from, to);
		notify();
	};

	// What the run says has changed is what makes the window stale, and a burst of changes reads it once. Only a change
	// this view would show counts: reading the run is itself steps the run records, at a level under any view's, so a
	// view that re-read for those would re-read for its own reading, without end.
	const shows = new Set(HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(level)));
	const unsubscribe = subscribeBatchedEvents({
		onBatch: (events) => {
			if (due || !events.some((e) => shows.has((e as { level?: THaibunLogLevel }).level ?? "info"))) return;
			due = setTimeout(() => {
				due = null;
				// A read nothing awaits still says when it failed: a view left showing an older window with no word of
				// why is a view a reader cannot tell apart from one that is current.
				read().catch((err: unknown) => failFastOrLog("the run could not be read again", err));
			}, reReadAfterMs);
		},
	});

	// Another execution is another window over the same records, so the source reads again rather than being remade.
	const stopWatchingSwitch = subscribeExecutionSwitch(() => {
		at = undefined;
		window = [];
		held.clear();
		void read();
	});

	const source: TGraphRunSource = {
		level,
		pageSize: getWindowSize(),
		get loaded() {
			return loaded;
		},
		get unavailable() {
			return null;
		},
		get ended() {
			return false;
		},
		extent: () => extent,
		cachedRanges: (): Range[] => (rows.length ? [{ from: 0, to: rows.length }] : []),
		count: () => rows.length,
		rowAt: (index: number) => rows[index],
		markers: (): TScrollMarker[] => [],
		ensureRange: () => Promise.resolve(),
		ready: () => (reading ??= read().finally(() => (reading = null))),
		readAt: (moment?: number) => {
			at = moment;
			window = []; // another moment is another window, read as one rather than added to the one being left
			return read();
		},
		subscribe: (fn: () => void) => {
			subs.add(fn);
			return () => subs.delete(fn);
		},
		close: () => {
			stopReading();
			stopWatchingSwitch();
			unsubscribe();
			if (due) clearTimeout(due);
		},
	};
	// A view of what this page holds lists what is being read, whichever kind of source reads it.
	const stopReading = readingBy(source);
	return source;
}
