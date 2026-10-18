/**
 * The readings of actuality the views share, and a reading at one level over the records actuality wrote.
 *
 * Actuality is in the graph: a step is a `SeqPath` individual, what it logged and what it produced point back at it. A
 * reading serves a view the window of that actuality a reader reads. A step is one row: it began, it ended and it states how it went,
 * all on one record. The window reads again when actuality reports something changed, and a view following the newest
 * reads only what has happened since it last read, which is what keeps an actuality of years readable.
 */
import { machine } from "@haibun/core/lib/machines/machine.js";
import { ActualityMoveSchema, actualityMachine, executionEnded } from "@haibun/core/lib/actuality/machines/actuality.js";
import type { TQuad } from "@haibun/core/lib/quad-types.js";
import { EventLevelSchema, HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/lib/domains/protocol.js";
import type { TClock, TEvent, TEventStream } from "../../ports.js";
import { batchedEvents } from "../../pipelines/batched-events.js";
import { railAt, momentAt, type Range, type TActualityFocus, type TActualitySpan, type TScrollMarker } from "../../derivations/rail.js";
import type { ActualitySource, TEventRecord, TActualityExtent, TActualityGraph, TActualityRegistry } from "../ports.js";
import { inActualityOrder, producedUnderSteps, type TActualityRow } from "../derivations/actuality-rows.js";
import { ofExecution } from "../derivations/actuality-graph.js";
import { individualAsQuads } from "../derivations/quads.js";
import { asRendered, renderedAt } from "../derivations/rendered-rows.js";
import { INITIAL_READING, READING_EVENT, READING_STATUS, readingStatus, readingTransition, type TReadingEvent, type TReadingState } from "../machines/reading.js";
import { actualityExtent, actualityWindow } from "./actuality-window.js";
import { ACTUALITY_DIVISIONS, actualityShape } from "./actuality-shape.js";

/** The level an event reports at, as the protocol reads it. */
const levelOf = (event: TEvent): THaibunLogLevel => EventLevelSchema.parse(event).level;

/** Actuality sources being read, in level order: what a view of the page's own caches reads, without making one. */
export function actualitySources(registry: TActualityRegistry): ActualitySource[] {
	return [...registry.reading].sort((a, b) => HAIBUN_LOG_LEVELS.indexOf(a.level) - HAIBUN_LOG_LEVELS.indexOf(b.level));
}

/** The moment actuality is read around, or undefined while the newest records are being followed. */
export function actualityReadingAt(registry: TActualityRegistry): number | undefined {
	return registry.at;
}

/** Whether a source's window already holds a moment, so reading it there would read the records it holds. Following
 *  the newest records is holding them: a window whose newest row is the newest the page has seen of actuality is already
 *  where a reader returning to the live edge is going. A source that hasn't read a record doesn't hold one. */
function alreadyHolds(registry: TActualityRegistry, source: ActualitySource, moment: number | undefined): boolean {
	const { first, last } = source.extent();
	if (first === undefined || last === undefined) return false;
	return moment === undefined ? last >= actualitySpan(registry).last : moment >= first && moment <= last;
}

/** Read actuality around a moment, on every source a view reads; `null` follows the newest records again.
 *
 * What a reader reads is what is read. A window holds a few thousand records, so the window doesn't hold a moment far from
 * the newest, and a reader moving there without a new read would be shown the records they had left rather than the ones
 * they requested. A source whose window already holds the moment doesn't read again, which is what bounds this: playback
 * moves the cursor every frame, and actuality is read again only when the cursor leaves the window. */
export async function readActualityAt(registry: TActualityRegistry, at: number | null): Promise<void> {
	const moment = at === null ? undefined : at;
	if (registry.at === moment) return;
	registry.at = moment;
	await Promise.all(
		actualitySources(registry)
			.filter((source) => !alreadyHolds(registry, source, moment))
			.map((source) => source.readAt(moment)),
	);
}

/** Report a source a view is reading by; the returned function reports it has stopped. */
export function readingBy(registry: TActualityRegistry, source: ActualitySource): () => void {
	registry.reading.add(source);
	for (const fn of registry.made) fn(source);
	return () => registry.reading.delete(source);
}

/** Subscribe to each actuality source as it is made (a view reading a level for the first time). Returns an unsubscribe. */
export function subscribeActualitySources(registry: TActualityRegistry, fn: (source: ActualitySource) => void): () => void {
	registry.made.add(fn);
	return () => registry.made.delete(fn);
}

/** Report what a source has seen of actuality's extent. */
export function noteActualitySpan(registry: TActualityRegistry, first: number | undefined, last: number | undefined): void {
	const held = registry.span;
	if (first !== undefined && (held.first === undefined || first < held.first)) held.first = first;
	if (last !== undefined && (held.last === undefined || last > held.last)) held.last = last;
}

/** When actuality the page reads starts and ends, over every level read: the earliest start and the newest row. It doesn't
 *  send a request or hold a record, so a control that only places the cursor (playback, the actions bar) reads it without
 *  reading actuality. Both 0 before any view has read actuality. */
export function actualitySpan(registry: TActualityRegistry): { first: number; last: number } {
	const held = registry.span;
	let first = held.first === undefined ? Number.POSITIVE_INFINITY : held.first;
	let last = held.last === undefined ? 0 : held.last;
	for (const src of registry.reading) {
		const { first: f, last: l } = src.extent();
		if (f !== undefined && f < first) first = f;
		if (l !== undefined && l > last) last = l;
	}
	return Number.isFinite(first) ? { first, last } : { first: 0, last: 0 };
}

/** Whether an instant is actuality's live edge: at or past its newest row, as the sources hold it. The ONE rule that
 *  places every view's cursor: a row that is the newest is the live edge, and the cursor there is null (the slider at its
 *  end, every view following), never a cutoff that excludes what comes next. */
export function atLiveEdge(registry: TActualityRegistry, instant: number): boolean {
	const { last } = actualitySpan(registry);
	return last > 0 && instant >= last;
}

/** How many places a rail has: the place of a mark and what a press names. A rail is a few hundred pixels, so this is
 *  finer than a reader's pointer, and the same however long actuality is. */
const RAIL_PLACES = 1000;

export type TGraphActualitySource = ActualitySource & { close(): void };

/** What a reading of actuality reads and writes: the page's readings, the graph of actuality's records, the execution the
 *  page reads, the device that holds what a window read, the stream of what actuality announces, the clock, the time
 *  cursor, the page size, and the report of a failure. */
export type TActualitySourceScope = {
	registry: TActualityRegistry;
	graph: () => TActualityGraph;
	executions: { chosen(): string | undefined; reading(): string | undefined; observe(execution: string): void; onSwitch(fn: () => void): () => void };
	hold: (quads: TQuad[]) => Promise<void>;
	events: TEventStream;
	clock: TClock;
	setCursor: (moment: number | null) => void;
	pageSize: number;
	report: (message: string, err: unknown) => void;
};

/** The options of a reading: how many records its window holds, how long a burst of changes is collected before it reads
 *  again, whether it reads the steps run to carry other steps out, and what it does once the views let it go. */
export type TActualitySourceOptions = { size: number; reReadAfterMs: number; substeps: boolean; release: () => void };

/** Returns a reading of actuality at `level`. */
export function makeGraphActualitySource(
	scope: TActualitySourceScope,
	level: THaibunLogLevel,
	{ size, reReadAfterMs, substeps, release }: TActualitySourceOptions,
): TGraphActualitySource {
	let rows: TEventRecord[] = [];
	let extent: TActualityExtent = { total: 0 };
	let loaded = false;
	// The moment the page reads actuality around: a source made while a reader is reading the past starts where they are
	// rather than at the newest records, so two views of one actuality cannot show two moments of it.
	let at: number | undefined = actualityReadingAt(scope.registry);
	let reading: Promise<void> | null = null;
	let due: (() => void) | undefined;
	// How current the reading is, as facts of the reading rather than inferences from what arrives: each announcement
	// this source shows (or the stream coming back, which reports the same) is numbered, a read that begins has read for
	// every announcement numbered so far once it finishes, and the stream is down or not. Numbers rather than clocks,
	// so an announcement and a read in the same instant are still ordered. A view waits on these, never on time.
	const currency = machine<TReadingState, TReadingEvent>(INITIAL_READING, readingTransition);
	// The execution's levels, moved by the lifecycle events the stream carries: actuality is finished where the machine
	// holds its execution ended. A source that joins after the execution ended reads the records and not that end.
	const actuality = actualityMachine();
	const subs = new Set<() => void>();
	// Each change of what the source holds or states increments its version, so a view derives from the source again
	// only where the version differs from the one of its last derivation.
	let version = 0;
	const notify = (): void => {
		version += 1;
		for (const fn of subs) fn();
	};

	// A row a re-read finds again is the same row: a view holds its place, and what it built from that row, by the row
	// being the same object. Re-reading is how a window stays current, so re-reading must not look like every row changing.
	const held = new Map<string, TEventRecord>();
	/** What the store reported about a row: what a re-read compares, so a row read again is the same row. */
	const keyOf = (row: TActualityRow): string => JSON.stringify([row.kind, row.step, row.at, row.text, row.status, row.endedAt]);
	/** What a view renders from a row, which is what the store reported and what the window claims it carries. */
	const renderKey = (row: TActualityRow): string => JSON.stringify([keyOf(row), row.produced?.length, row.carriedBy]);
	const same = (row: TActualityRow): TEventRecord => {
		const key = renderKey(row);
		const carried = held.get(key);
		if (carried) return carried;
		const made = asRendered(row);
		held.set(key, made);
		return made;
	};
	/** Hold what a window read, in one write. Where the device is full, what it holds of another actuality makes room; where
	 *  it could not be held at all, that is reported rather than left for a reader to find missing later. */
	const hold = (rows: TActualityRow[]): Promise<void> => {
		if (rows.length === 0) return Promise.resolve();
		return scope.hold(rows.flatMap((row) => individualAsQuads(row.label, row.record)[1]));
	};

	/** The newest recording the window holds: a following read reads what happened since. A row that does not state
	 *  when it was recorded reads everything recorded since records began to state it. */
	const recordedThrough = (rows: TActualityRow[]): number => Math.max(0, ...rows.flatMap((row) => (row.recordedAt === undefined ? [] : [row.recordedAt])));

	/** The rows the window holds, oldest first, and what they span: what every view of this source reads. */
	let window: TActualityRow[] = [];

	/**
	 * Read actuality. Following the live edge, a view already holding rows reads only what changed after its last read:
	 * the records that began after its newest row, and the steps that ended after it. Reading the whole window again to
	 * find a few new records is what makes following a long actuality take as long as its whole length. Anywhere else, the
	 * window is read around where the reader is.
	 */
	const read = async (): Promise<void> => {
		const readFor = currency.state.get().announced;
		// A read that has finished has read for every announcement made before it began; what it read is announced once,
		// where the reading is complete.
		const done = (): void => {
			currency.dispatch({ type: READING_EVENT.SETTLE, readFor });
		};
		const execution = scope.executions.chosen();
		const of = { size, minLevel: level, substeps, ...(execution === undefined ? {} : { execution }) };
		const following = at === undefined && window.length > 0;
		const answer = await actualityWindow(scope.graph(), following ? { ...of, since: recordedThrough(window) } : { ...of, ...(at === undefined ? {} : { at }) });
		if (following) {
			// A record read again replaces the one held under its name; one not held before is new. Either way the
			// window is what it held and what has changed, in the order actuality put them.
			const byName = new Map(window.map((row) => [row.id, row]));
			const changed = answer.rows.filter((row) => byName.get(row.id) === undefined || keyOf(byName.get(row.id) as TActualityRow) !== keyOf(row));
			if (changed.length === 0) {
				done();
				return notify();
			}
			for (const row of changed) byName.set(row.id, row);
			window = [...byName.values()].sort(inActualityOrder).slice(-size);
		} else window = answer.rows;
		// What a step produced is claimed over the window as it now stands: a shot is recorded after the step that took
		// it, so a read that finds the shot alone would leave it unclaimed.
		producedUnderSteps(window);
		// What a page has read, it holds: the records are what a reader without a site reads back, and what lets this
		// device return to an execution. Only what is new to the window is written,
		// and every new record in one write, so reading a window is one write rather than one per record.
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
		noteActualitySpan(scope.registry, from, to);
		done();
		// The rail carries all of the execution, so it is read where the window is: what the execution reaches, and what
		// its divisions hold. A rail read that fails leaves the rail as it was rather than emptying it under a reader.
		await readRail().catch((err: unknown) => scope.report("actuality's rail could not be read", err));
		notify();
		// Last of all: recording the execution this window shows can report a change of the execution being read, and the
		// source that reads again on that change is this same source. A read that announced before it had finished would
		// return the window that change leaves.
		if (newest) scope.executions.observe(newest.execution);
	};

	// What actuality reports has changed is what makes the window stale, and a burst of changes reads it once. Only a change
	// this view would show counts. What keeps a view from reading for its own reading is that serving a read is not
	// announced at all, which is stated where a call is served: a view reading at the lowest level would otherwise
	// announce, read, be served, and announce again without end.
	const shows = new Set(HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(level)));
	const readSoon = () => {
		if (due) return;
		due = scope.clock.after(reReadAfterMs, () => {
			due = undefined;
			// A read that a caller doesn't await still reports when it failed: a view left showing an older window without a
			// report of why is a view a reader cannot tell apart from one that is current.
			read().catch((err: unknown) => scope.report("actuality could not be read again", err));
		});
	};
	const announce = (): void => {
		currency.dispatch({ type: READING_EVENT.ANNOUNCE });
		notify();
		readSoon();
	};
	const unsubscribe = batchedEvents(scope.events, scope.clock, {
		onBatch: (events) => {
			const wasEnded = executionEnded(actuality.state.get());
			for (const event of events) {
				const move = event.kind === "lifecycle" ? ActualityMoveSchema.safeParse(event) : undefined;
				if (move?.success) actuality.dispatch(move.data);
			}
			if (events.some((e) => shows.has(levelOf(e)))) announce();
			else if (wasEnded !== executionEnded(actuality.state.get())) notify();
		},
		// What actuality recorded while the stream was down didn't arrive in a batch: the stream coming back is the same
		// reason to read again, on the same schedule, and until that read has finished the reading is behind.
		onReconnect: () => {
			currency.dispatch({ type: READING_EVENT.RECONNECT });
			notify();
			readSoon();
		},
		onDisconnect: () => {
			currency.dispatch({ type: READING_EVENT.DISCONNECT });
			notify();
		},
	});

	// What actuality reaches, and what it holds along the way, counted rather than read: a rail carrying a year takes its
	// divisions rather than actuality. Both are read where the window is read, so they move with it.
	let reach: TActualitySpan = { first: 0, last: 0 };
	let railMarks: TScrollMarker[] = [];
	/** The graph of the execution being read. A device holds more than one execution, so a rail over every record it
	 *  holds would span executions the reader is not reading. */
	const runGraph = (): TActualityGraph => ofExecution(scope.graph(), scope.executions.reading());
	let shape = actualityShape(runGraph(), { minLevel: level, divisions: ACTUALITY_DIVISIONS });
	/** Where the reader is on the rail, and the window held around them: the moment they are reading around, else the
	 *  newest record read. */
	const focus = (): TActualityFocus => ({ at: at ?? extent.last ?? reach.last, from: extent.first ?? reach.first, to: extent.last ?? reach.last });
	const placeFor = (moment: number): number => Math.round(railAt(moment, reach, focus()) * Math.max(1, RAIL_PLACES - 1));
	const readRail = async (): Promise<void> => {
		// Where an actuality begins does not change while it runs, so it is read once; where it reaches is the newest record
		// the window just read, except where the reader is reading the past and the window is not at the live edge.
		const newest = at === undefined ? extent.last : undefined;
		reach = reach.first > 0 && newest !== undefined ? { first: reach.first, last: Math.max(reach.last, newest) } : await actualityExtent(runGraph(), level);
		if (reach.last <= reach.first) {
			railMarks = [];
			return;
		}
		// The rail spans all of the execution, so what it reaches is what every view scrubbing it reads.
		noteActualitySpan(scope.registry, reach.first, reach.last);
		// The counting is of actuality, so it is held across reads and only the stretch actuality has grown by is counted.
		// Where it is drawn is of the reader, so the places are computed again on every read: a reader who moves changes
		// the scale under the same marks.
		await shape.update(reach.last);
		railMarks = shape.marks.map((mark) => ({ color: mark.color, icon: mark.icon, index: placeFor(mark.at), id: `run-${mark.at}` }));
	};

	// Another execution is another window over the same records, so the source reads again rather than being remade.
	const stopWatchingSwitch = scope.executions.onSwitch(() => {
		at = undefined;
		window = [];
		held.clear();
		// The counts are of the execution read before, so another execution is counted from zero rather than added.
		shape = actualityShape(runGraph(), { minLevel: level, divisions: ACTUALITY_DIVISIONS });
		reach = { first: 0, last: 0 };
		void read();
	});

	const source: TGraphActualitySource = {
		level,
		get version() {
			return version;
		},
		// The rail of this window's rows: actuality's whole reach, focused where the reader is reading. A window holds
		// a few thousand records and an actuality can hold a year of them, so a rail spread over the window alone wouldn't
		// count the rest of actuality. The reach and the marks are read where the window is read, so a rail of a
		// year takes the counts its divisions take rather than what actuality did.
		rail: {
			places: RAIL_PLACES,
			placeOf: (index: number) => {
				const row = rows[index];
				return placeFor(row === undefined ? reach.first : renderedAt(row));
			},
			marks: () => railMarks,
			goTo: (place: number) => {
				const moment = momentAt(place / Math.max(1, RAIL_PLACES - 1), reach, focus());
				scope.setCursor(atLiveEdge(scope.registry, moment) ? null : moment);
			},
		},
		pageSize: scope.pageSize,
		get loaded() {
			return loaded;
		},
		get unavailable() {
			return null;
		},
		get ended() {
			return executionEnded(actuality.state.get());
		},
		get disconnected() {
			return readingStatus(currency.state.get()) === READING_STATUS.CUT_OFF;
		},
		get behind() {
			const state = currency.state.get();
			return state.settled < state.announced;
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
		// A view holds the source by subscribing to it, and lets it go by unsubscribing. A source the views don't hold is
		// reading an actuality the reader isn't shown: it stops, and the next view to read at this level starts one afresh.
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
			due?.();
		},
	};
	// A view of what this page holds lists what is being read, whichever kind of source reads it.
	const stopReading = readingBy(scope.registry, source);
	return source;
}
