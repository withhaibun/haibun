/**
 * What every view of a run shares, whichever window of it they are reading: the interface a source answers, the sources
 * being read, and the span the run covers.
 *
 * A run is read one way, over the records the run wrote (`graph-run-source`). This holds what is true of any reading of
 * it: the rows a view asks for by index, the extent it spans, and the live edge every view places the shared cursor by.
 */
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import type { WindowedSource } from "../windowed-source.js";
import { pagePinned } from "../page-pinned.js";
import type { Range } from "../ranges.js";

export type TEventRecord = Record<string, unknown>;

/** What the run spans at one level: how many rows, when it began, and the instant of its newest. */
export type TRunExtent = { total: number; first?: number; last?: number };

export interface RunSource extends WindowedSource<TEventRecord> {
	/** The level this source reads at (its rows are at this level and up). */
	readonly level: THaibunLogLevel;
	/** The run's extent as known: how many rows at this level, when the run began, and the instant of its newest. */
	extent(): TRunExtent;
	/** The index spans held, in order: what a view derives its marks and cursor from, never a scan of the extent. */
	cachedRanges(): Range[];
	/** How many rows a page holds: a view that derives per page (the document's blocks) aligns to it. */
	readonly pageSize: number;
	/** Whether the extent has been read. */
	readonly loaded: boolean;
	/** Why the run could not be read, or null. */
	readonly unavailable: string | null;
	/** Whether the run is finished. */
	readonly ended: boolean;
	/** Learn the extent if not yet known: the first thing a view awaits. */
	ready(): Promise<void>;
	/** Read the run around a moment, or follow its newest records where none is named. */
	readAt(at?: number): Promise<void>;
}

/** The sources a view is reading the run by, so a view of what this page holds lists what is actually being read. */
const READING_KEY = "__SHU_RUN_SOURCES_READING__";
const reading = (): Set<RunSource> => pagePinned(READING_KEY, () => new Set<RunSource>());
const MADE_KEY = "__SHU_RUN_SOURCES_MADE__";
const made = (): Set<(source: RunSource) => void> => pagePinned(MADE_KEY, () => new Set<(source: RunSource) => void>());

/** The run sources being read, in level order: what a view of the page's own caches reads, making none. */
export function runSources(): RunSource[] {
	return [...reading()].sort((a, b) => HAIBUN_LOG_LEVELS.indexOf(a.level) - HAIBUN_LOG_LEVELS.indexOf(b.level));
}

/** The moment the run is read around, held by the page rather than by each source: every view of a run reads the same
 *  moment of it, and a source made after the moment was set starts there rather than at the newest records. Undefined
 *  is the newest records, which is what a run is read at until a reader moves. */
const READING_AT_KEY = "__SHU_RUN_READING_AT__";
const readingAt = (): { at?: number } => pagePinned(READING_AT_KEY, () => ({}));

/** The moment the run is read around, or undefined while the newest records are being followed. */
export function runReadingAt(): number | undefined {
	return readingAt().at;
}

/** Whether a source's window already holds a moment, so reading it there would read the records it holds. Following
 *  the newest records is holding them: a window whose newest row is the newest the page has seen of the run is already
 *  where a reader returning to the live edge is going. A source that has read nothing holds nothing. */
function alreadyHolds(source: RunSource, moment: number | undefined): boolean {
	const { first, last } = source.extent();
	if (first === undefined || last === undefined) return false;
	return moment === undefined ? last >= runSpan().last : moment >= first && moment <= last;
}

/** Read the run around a moment, on every source a view is reading by; `null` follows the newest records again.
 *
 * What a reader is looking at is what is read. A window holds a few thousand records, so a moment far from the newest
 * is a moment no window holds, and a reader moving there with nothing read would be shown the records they had left
 * rather than the ones they asked for. A source whose window already holds the moment reads nothing, which is what
 * bounds this: playback moves the cursor every frame, and a run is read again only when the cursor leaves the window. */
export async function readRunAt(at: number | null): Promise<void> {
	const moment = at ?? undefined;
	const held = readingAt();
	if (held.at === moment) return;
	held.at = moment;
	await Promise.all(runSources().filter((source) => !alreadyHolds(source, moment)).map((source) => source.readAt(moment)));
}

/** Report a source a view is reading by; the returned function says it has stopped. */
export function readingBy(source: RunSource): () => void {
	reading().add(source);
	for (const fn of made()) fn(source);
	return () => reading().delete(source);
}

/** Subscribe to each run source as it is made (a view reading a level for the first time). Returns an unsubscribe. */
export function subscribeRunSources(fn: (source: RunSource) => void): () => void {
	made().add(fn);
	return () => made().delete(fn);
}

/** What the run spans, as whatever has read it has seen. Held by the page, since a run's extent is the run's rather
 *  than one reader's, and the live edge is read from it. The span only widens: a window over part of a run says
 *  nothing about the rest, so a narrower reading never contradicts a wider one. */
const SPAN_KEY = "__SHU_RUN_SPAN__";
const span = (): { first?: number; last?: number } => pagePinned(SPAN_KEY, () => ({}));

/** Report what a source has seen of the run's extent. */
export function noteRunSpan(first?: number, last?: number): void {
	const held = span();
	if (first !== undefined && (held.first === undefined || first < held.first)) held.first = first;
	if (last !== undefined && (held.last === undefined || last > held.last)) held.last = last;
}

/** When the run the page reads starts and ends, over every level read: the earliest start and the newest row. Asks for
 *  nothing and holds nothing, so a control that only places the cursor (playback, the actions bar) reads it without
 *  reading the run in. Both 0 before any view has read the run. */
export function runSpan(): { first: number; last: number } {
	const held = span();
	let first = held.first ?? Number.POSITIVE_INFINITY;
	let last = held.last ?? 0;
	for (const src of reading()) {
		const { first: f, last: l } = src.extent();
		if (f !== undefined && f < first) first = f;
		if (l !== undefined && l > last) last = l;
	}
	return Number.isFinite(first) ? { first, last } : { first: 0, last: 0 };
}

/** Whether an instant is the run's live edge: at or past its newest row, as the sources know it. The ONE rule every
 *  view places the cursor by: a row that is the newest is the live edge, and the cursor there is null (the slider at its
 *  end, every view following), never a cutoff that excludes what comes next. */
export function atLiveEdge(instant: number): boolean {
	const { last } = runSpan();
	return last > 0 && instant >= last;
}

/** Test-only: forget the span and who is reading, so a test starts on a page that has read nothing. */
export function resetRunSources(): void {
	reading().clear();
	made().clear();
	readingAt().at = undefined;
	const held = span();
	held.first = undefined;
	held.last = undefined;
}
