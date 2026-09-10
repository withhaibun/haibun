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
import { pageRunGraph } from "../quads-snapshot.js";
import { ofExecution, type TRunGraph } from "./run-graph.js";
import { individualAsQuads } from "./quad-store.js";
import { currentExecution, holdOnDevice, noteExecution, readingExecution, subscribeExecutionSwitch } from "./executions.js";
import { failFastOrLog } from "@haibun/core/lib/dev-mode.js";
import type { Range } from "../ranges.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { RUN_WINDOW_SIZE, inRunOrder, producedUnderSteps, runExtent, runWindow, type TRunRow } from "./run-window.js";
import { runShape } from "./run-shape.js";
import { railAt, momentAt, type TRunFocus, type TRunSpan } from "../run-scale.js";
import { timeCursor } from "../signals.js";
import { atLiveEdge, noteRunSpan, readingBy, runReadingAt, type RunSource, type TEventRecord, type TRunExtent } from "./run-source.js";

/** How long a burst of changes is collected before the window is read again. */
export const RE_READ_AFTER_MS = 250;

/** How many places a rail has: what a mark sits at and what a press names. A rail is a few hundred pixels, so this is
 *  finer than a reader can point at, and the same however long the run is. */
export const RAIL_PLACES = 1000;

/** What a step declared, where it declared one: a feature or a scenario is the step that named it, and a view titles it
 *  by the name that step carries rather than by a second announcement of the same thing. */
function declared(row: TRunRow): Record<string, unknown> {
	if (declaresFeature(row.called)) return { type: "feature", featureName: declaredName(row.text, "feature") };
	if (declaresScenario(row.called)) return { type: "scenario", scenarioName: declaredName(row.text, "scenario") };
	return { type: "step" };
}

/** Which record a rendered row is: its type and its own name. A row shows a step's path, and what was said under a step
 *  shows that step's, so without this a row of what a run said cannot be told from the step it was said during, and a
 *  reader pressing it has nothing to open. */
const recordOf = (row: TRunRow): { persistedAs: string; id: string } => ({ persistedAs: row.label, id: row.id });

/** A row as a view renders it. A step carries how it went and how long it took; what was said carries its own level. */
function asRendered(row: TRunRow): TEventRecord {
	// The step path a view shows and navigates by is the path within the execution: the execution is how records of
	// different runs are told apart, not something a reader of one run is shown on every row.
	const seqPath = row.under?.length ? row.under : undefined;
	if (row.kind === "said") return { id: row.step, kind: "log", level: row.level, message: row.text, timestamp: row.at, seqPath, record: recordOf(row) };
	// A produced thing is claimed by the step it came from, which a document reads from the identity it carries.
	if (row.kind === "produced") return producedRecord(row);
	return stepRecord(row, seqPath);
}

/** What a step produced, as a view renders it. */
function producedRecord(row: TRunRow): TEventRecord {
	const seqPath = row.under?.length ? row.under : undefined;
	return {
		id: row.id,
		kind: "artifact",
		artifactType: row.artifactType,
		level: row.level,
		timestamp: row.at,
		...(row.path === undefined ? {} : { path: row.path }),
		...(row.featureRelativePath === undefined ? {} : { featureRelativePath: row.featureRelativePath }),
		...(row.mediaType === undefined ? {} : { mimetype: row.mediaType }),
		...(row.carriedBy === undefined ? {} : { carriedBy: row.carriedBy }),
		seqPath,
		record: recordOf(row),
	};
}

/** A step's own record, as a view renders it, carrying what that step produced. */
function stepRecord(row: TRunRow, seqPath: number[] | undefined): TEventRecord {
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
		// The step a substep was run to carry out, so a reader shown one reads the step that established it.
		...(row.partOf === undefined ? {} : { partOf: row.partOf }),
		// What this step produced, shown by the row of the step a reader sees rather than by rows of its own.
		...(row.produced === undefined ? {} : { produced: row.produced.map(producedRecord) }),
		seqPath,
		record: recordOf(row),
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

export type TGraphRunSource = RunSource & { close(): void };

/** Stop reading a run nothing is showing, and forget it, so the next view to read at that level reads afresh. */
function releaseSource(key: string): void {
	const held = sources().get(key);
	if (held === undefined) return;
	sources().delete(key);
	held.close();
}

export function graphRunSource(level: THaibunLogLevel, options: { size?: number; reReadAfterMs?: number; substeps?: boolean } = {}): TGraphRunSource {
	// A reading is what its level and what it shows of the steps run to carry other steps out: two views asking for the
	// same reading share one, and a view asking to see substeps reads a run of its own rather than filtering one.
	const key = options.substeps ? `${level}+substeps` : level;
	const held = sources().get(key);
	if (held) return held;
	const made = makeGraphRunSource(level, { ...options, release: () => releaseSource(key) });
	sources().set(key, made);
	return made;
}

function makeGraphRunSource(
	level: THaibunLogLevel,
	{
		size = RUN_WINDOW_SIZE,
		reReadAfterMs = RE_READ_AFTER_MS,
		substeps = false,
		release = () => undefined,
	}: { size?: number; reReadAfterMs?: number; substeps?: boolean; release?: () => void },
): TGraphRunSource {
	let rows: TEventRecord[] = [];
	let extent: TRunExtent = { total: 0 };
	let loaded = false;
	// The moment the page reads the run around: a source made while a reader is reading the past starts where they are
	// rather than at the newest records, so two views of one run cannot show two moments of it.
	let at: number | undefined = runReadingAt();
	let reading: Promise<void> | null = null;
	let due: ReturnType<typeof setTimeout> | null = null;
	// How current the reading is, as facts of the reading rather than inferences from what arrives: each announcement
	// this source shows (or the stream coming back, which says the same) is numbered, a read that begins has read for
	// every announcement numbered so far once it finishes, and the stream is down or not. Numbers rather than clocks,
	// so an announcement and a read in the same instant are still ordered. A view waits on these, never on time.
	let announced = 0;
	let settled = 0;
	let disconnected = false;
	const subs = new Set<() => void>();
	const notify = (): void => {
		for (const fn of subs) fn();
	};

	// A row a re-read finds again is the same row: a view holds its place, and what it built from that row, by the row
	// being the same object. Re-reading is how a window stays current, so re-reading must not look like every row changing.
	const held = new Map<string, TEventRecord>();
	/** What the store said about a row: what a re-read compares, so a row read again is the same row. */
	const keyOf = (row: TRunRow): string => `${row.kind}|${row.step}|${row.at}|${row.text}|${row.status ?? ""}|${row.endedAt ?? ""}`;
	/** What a view renders from a row, which is what the store said and what the window claims it carries. */
	const renderKey = (row: TRunRow): string => `${keyOf(row)}|${row.produced?.length ?? 0}|${row.carriedBy ?? ""}`;
	const same = (row: TRunRow): TEventRecord => {
		const key = renderKey(row);
		const carried = held.get(key);
		if (carried) return carried;
		const made = asRendered(row);
		held.set(key, made);
		return made;
	};
	/** Hold what a window read, in one write. Where the device is full, what it holds of another run makes room; where
	 *  it could not be held at all, that is said rather than left for a reader to find missing later. */
	const hold = (rows: TRunRow[]): Promise<void> => {
		if (rows.length === 0) return Promise.resolve();
		return holdOnDevice(rows.flatMap((row) => individualAsQuads(row.label, row.record)[1]));
	};

	/** The newest recording the window holds: what a following read asks for what happened since by. A row that does
	 *  not say when it was recorded asks for everything recorded since records began to say. */
	const recordedThrough = (rows: TRunRow[]): number => Math.max(0, ...rows.map((row) => row.recordedAt ?? 0));

	/** The rows the window holds, oldest first, and what they span: what every view of this source reads. */
	let window: TRunRow[] = [];

	/**
	 * Read the run. Following the live edge, a view already holding rows asks only for what changed after its last
	 * read: the records that began after its newest row, and the steps that ended after it. Reading the whole window
	 * again to find a few new records is what makes following a long run cost what the run costs. Anywhere else, the
	 * window is read around where the reader is.
	 */
	const read = async (): Promise<void> => {
		const readFor = announced;
		// A read that has finished has read for every announcement made before it began, whether or not it found
		// anything new; one begun before an announcement leaves that to the read the announcement scheduled.
		// A read that has finished has read for every announcement made before it began; what it read is announced once,
		// where the reading is complete.
		const done = (): void => {
			settled = Math.max(settled, readFor);
		};
		const execution = currentExecution();
		const of = { size, minLevel: level, substeps, ...(execution === undefined ? {} : { execution }) };
		const following = at === undefined && window.length > 0;
		const answer = await runWindow(pageRunGraph(), following ? { ...of, since: recordedThrough(window) } : { ...of, ...(at === undefined ? {} : { at }) });
		if (following) {
			// A record read again replaces the one held under its name; one not held before is new. Either way the
			// window is what it held and what has changed, in the order the run put them.
			const byName = new Map(window.map((row) => [row.id, row]));
			const changed = answer.rows.filter((row) => byName.get(row.id) === undefined || keyOf(byName.get(row.id) as TRunRow) !== keyOf(row));
			if (changed.length === 0) {
				done();
				return notify();
			}
			for (const row of changed) byName.set(row.id, row);
			window = [...byName.values()].sort(inRunOrder).slice(-size);
		} else window = answer.rows;
		// What a step produced is claimed over the window as it now stands: a shot is recorded after the step that took
		// it, so a read that finds the shot alone would leave it claimed by nothing.
		producedUnderSteps(window);
		// What a page has read, it holds: the records are what a reader with no site to ask reads them back from, and
		// what makes an execution one this device can be brought back to. Only what is new to the window is written,
		// and every new record in one write, so reading a window costs one write rather than one per record.
		void hold(window.filter((row) => !held.has(renderKey(row))));
		rows = window.map(same);
		// What the window no longer holds is not held here either, so a window that moves does not grow this without bound.
		const shown = new Set(rows);
		for (const [key, row] of held) if (!shown.has(row)) held.delete(key);
		const newest = window[window.length - 1]?.name;
		const from = window[0]?.at;
		const to = window[window.length - 1]?.at;
		extent = { total: rows.length, ...(from === undefined ? {} : { first: from }), ...(to === undefined ? {} : { last: to }) };
		loaded = true;
		noteRunSpan(from, to);
		done();
		// The rail carries the whole run, so it is read where the window is: what the run reaches, and what its divisions
		// hold. A rail read that fails leaves the rail as it was rather than emptying it under a reader.
		await readRail().catch((err: unknown) => failFastOrLog("the run's rail could not be read", err));
		notify();
		// Last of all: saying which run this window is of can be what says the run being read has changed, and what
		// reads a run again on hearing that is this same source. A read that announced before it had finished would be
		// answering with the window it was told to leave.
		if (newest) noteExecution(newest.execution);
	};

	// What the run says has changed is what makes the window stale, and a burst of changes reads it once. Only a change
	// this view would show counts. What keeps a view from reading for its own reading is that serving a read is not
	// announced at all, which is stated where a call is served: a view reading at the lowest level would otherwise
	// announce, read, be served, and announce again without end.
	const shows = new Set(HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(level)));
	const readSoon = () => {
		if (due) return;
		due = setTimeout(() => {
			due = null;
			// A read nothing awaits still says when it failed: a view left showing an older window with no word of
			// why is a view a reader cannot tell apart from one that is current.
			read().catch((err: unknown) => failFastOrLog("the run could not be read again", err));
		}, reReadAfterMs);
	};
	const announce = (): void => {
		announced += 1;
		notify();
		readSoon();
	};
	const unsubscribe = subscribeBatchedEvents({
		onBatch: (events) => {
			if (events.some((e) => shows.has((e as { level?: THaibunLogLevel }).level ?? "info"))) announce();
		},
		// What the run recorded while the stream was down arrived in no batch: the stream coming back is the same
		// reason to read again, on the same schedule, and until that read has finished the reading is behind.
		onReconnect: () => {
			disconnected = false;
			announce();
		},
		onDisconnect: () => {
			disconnected = true;
			notify();
		},
	});

	// What the run reaches, and what it holds along the way, counted rather than read: a rail carrying a year costs its
	// divisions rather than the run. Both are read where the window is read, so they move with it.
	let reach: TRunSpan = { first: 0, last: 0 };
	let railMarks: TScrollMarker[] = [];
	/** The graph of the run being read. A device holds more than one run, so a rail over every record it holds would
	 *  span runs the reader is not reading. */
	const runGraph = (): TRunGraph => ofExecution(pageRunGraph(), readingExecution());
	let shape = runShape(runGraph(), { minLevel: level });
	/** Where the reader is on the rail, and the window held around them: the moment they are reading around, else the
	 *  newest record read. */
	const focus = (): TRunFocus => ({ at: at ?? extent.last ?? 0, from: extent.first ?? reach.first, to: extent.last ?? reach.last });
	const placeFor = (moment: number): number => Math.round(railAt(moment, reach, focus()) * Math.max(1, RAIL_PLACES - 1));
	const readRail = async (): Promise<void> => {
		// Where a run begins does not change while it runs, so it is read once; where it reaches is the newest record
		// the window just read, except where the reader is reading the past and the window is not at the live edge.
		const newest = at === undefined ? extent.last : undefined;
		reach = reach.first > 0 && newest !== undefined ? { first: reach.first, last: Math.max(reach.last, newest) } : await runExtent(runGraph(), level);
		if (reach.last <= reach.first) {
			railMarks = [];
			return;
		}
		// The rail spans the whole run, so what it reaches is what every view scrubbing the run reads.
		noteRunSpan(reach.first, reach.last);
		// The counting is of the run, so it is held across reads and only the stretch the run has grown by is counted.
		// Where it is drawn is of the reader, so the places are computed again on every read: a reader who moves changes
		// the scale under the same marks.
		await shape.update(reach.last);
		railMarks = shape.marks.map((mark) => ({ color: mark.color, icon: mark.icon, index: placeFor(mark.at), id: `run-${mark.at}` }));
	};

	// Another execution is another window over the same records, so the source reads again rather than being remade.
	const stopWatchingSwitch = subscribeExecutionSwitch(() => {
		at = undefined;
		window = [];
		held.clear();
		// The counts are of the run that was being read, so another run is counted from nothing rather than added to.
		shape = runShape(runGraph(), { minLevel: level });
		reach = { first: 0, last: 0 };
		void read();
	});

	const source: TGraphRunSource = {
		level,
		// The rail this window's rows sit on: the run's whole reach, focused where the reader is reading. A window holds
		// a few thousand records and a run can hold a year of them, so a rail spread over the window alone would say
		// nothing about the rest of the run. The reach and the marks are read where the window is read, so a rail of a
		// year costs the counts its divisions cost rather than what the run did.
		rail: {
			places: RAIL_PLACES,
			placeOf: (index: number) => placeFor(Number(rows[index]?.timestamp) || reach.first),
			marks: () => railMarks,
			goTo: (place: number) => {
				const moment = momentAt(place / Math.max(1, RAIL_PLACES - 1), reach, focus());
				timeCursor.set(atLiveEdge(moment) ? null : moment);
			},
		},
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
		get disconnected() {
			return disconnected;
		},
		get behind() {
			return settled < announced;
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
		// A view holds the source by subscribing to it, and lets it go by unsubscribing. A source nothing holds is
		// reading a run nobody is shown: it stops, and the next view to read at this level starts one afresh.
		subscribe: (fn: () => void) => {
			subs.add(fn);
			return () => {
				subs.delete(fn);
				if (subs.size === 0) release();
			};
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
