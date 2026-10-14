/**
 * Actuality as a reader is looking at it: the records around a moment, in order.
 *
 * A run is in the graph. A step is a `SeqPath` individual and what it logged is a `LogMessage` individual pointing back
 * at it, so reading actuality is a query over those types by time, not a second history to keep. What a reader sees is a
 * window of a stated number of records around where they are, which is what keeps the time of looking the same whether
 * actuality has lasted an hour or a decade: the window is read by time, and within it a page is an offset that can never
 * exceed the window.
 *
 * A window at the live edge is the newest records; one around a moment is half before it and half after, and where a
 * side runs short the other side makes up the difference, so a window is always the size requested where the graph
 * holds that many.
 */
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { MAX_PAGE_ROWS, readInPages } from "@haibun/core/lib/hypermedia.js";
import { SUBSTEP_LEVEL, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { RECORDED_AT_TIME_FIELD } from "@haibun/core/lib/seq-path.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import type { TRunGraph } from "../ports.js";
import {
	RUN_TYPES,
	inRunOrder,
	instant,
	levelsFrom,
	newestExecution,
	oneEach,
	rowOfRecord,
	windowOf,
	type TRunRow,
	type TRunType,
	type TRunWindow,
} from "../derivations/run-rows.js";

/** A side that runs short is made up by the other, so a window is the size requested wherever the graph holds it. */
async function toppedUp(
	before: TRunRow[],
	after: TRunRow[],
	half: number,
	size: number,
	read: (direction: "before" | "after", limit: number) => Promise<TRunRow[]>,
): Promise<TRunRow[]> {
	const short = size - before.length - after.length;
	if (short <= 0) return [...before, ...after];
	if (before.length < half) return [...before, ...after, ...(await read("after", size - half + short)).slice(after.length)];
	return [...(await read("before", half + short)).slice(0, short), ...before, ...after];
}

/** The field every record states how prominently it reports by, which is the filter a level is. */
const LEVEL = "level";

/**
 * One type's records on one side of a moment, at the levels a reader is shown, in the order they are read from it.
 *
 * A level is part of the store's query rather than filtered out after reading: a record states its level, so a view
 * showing three of them queries those three. Reading every record of every level to drop most of them is what makes a
 * view of a chatty run read all of it.
 */
async function side(
	graph: TRunGraph,
	type: TRunType,
	at: number | undefined,
	direction: "before" | "after",
	limit: number,
	levels: readonly THaibunLogLevel[],
	// Whether the reader asked for the steps run to carry other steps out. Each type states whether that widens it.
	substeps: boolean,
): Promise<Record<string, unknown>[]> {
	const { label, timeField } = type;
	// A graph that does not carry a type doesn't hold a record of it, so its side is empty.
	if (!graph.declares(label)) return [];
	const when = at === undefined ? [] : [{ predicate: timeField, operator: direction === "before" ? "lt" : "gte", value: new Date(at).toISOString() }];
	// The levels this type is read at, which the type states: every read of it comes through here, so the window, the
	// extent and the counting cannot read one type differently.
	const read = type.widensBySubsteps && substeps && !levels.includes(SUBSTEP_LEVEL) ? [...levels, SUBSTEP_LEVEL] : levels;
	const shown = type.atEveryLevel ? [] : [{ predicate: LEVEL, operator: "in", value: read[0], values: [...read] }];
	const sortOrder = direction === "before" ? "desc" : "asc";
	const filters = [...when, ...shown];
	const readPage = (from: number, to: number) =>
		graph.query(GraphQuerySchema.parse({ label, filters, sortBy: timeField, sortOrder, offset: from, limit: to - from, skipCount: true }));
	return (await readInPages(readPage, 0, limit, MAX_PAGE_ROWS)).vertices;
}

/**
 * How far a run reaches: its first and last instants, over every kind of record it writes.
 *
 * Read rather than inferred from the part of it a reader holds. A window is a few thousand records however long a run
 * is, so a span taken from the window is the window's span; a bar drawn over that would show a decade's run as the few
 * minutes a reader happens to read. Two records are read per type, each the first or last of its own
 * order, so the time does not grow with actuality.
 *
 * Both zero for a run that hasn't written a record, which is a run without a span rather than a failure.
 */
export async function runExtent(graph: TRunGraph, minLevel: THaibunLogLevel): Promise<{ first: number; last: number }> {
	const levels = levelsFrom(minLevel);
	const ends = await Promise.all(
		RUN_TYPES.map(async (type) => {
			// The whole of it is read where a moment isn't named: the oldest record read forward, the newest read back.
			// The two reads don't wait on each other.
			const [first, last] = await Promise.all([instantAt(graph, type, undefined, "after", levels), instantAt(graph, type, undefined, "before", levels)]);
			return { first, last };
		}),
	);
	const firsts = ends.map((e) => e.first).filter((f): f is number => f !== undefined);
	const lasts = ends.map((e) => e.last).filter((l): l is number => l !== undefined);
	return firsts.length && lasts.length ? { first: Math.min(...firsts), last: Math.max(...lasts) } : { first: 0, last: 0 };
}

/** The instant of one record on one side of a moment, or undefined where the side doesn't hold one. Where a moment isn't
 *  named the whole of the type is the side. */
async function instantAt(graph: TRunGraph, type: TRunType, at: number | undefined, direction: "before" | "after", levels: readonly THaibunLogLevel[]): Promise<number | undefined> {
	// What a run reaches is the reach of the steps a reader reads, so the extent doesn't widen by substeps.
	const [record] = await side(graph, type, at, direction, 1, levels, false);
	if (!record) return undefined;
	const found = instant(record[type.timeField]);
	return Number.isNaN(found) ? undefined : found;
}

/**
 * The window around a moment, or the newest records where a moment isn't given, or, with `since`, what was recorded
 * since that instant. `size` is how many records the reader is shown; a level narrows what counts as a record, since a
 * reader asking for warnings is not shown everything under them.
 */
export async function runWindow(
	graph: TRunGraph,
	{ at, since, size, minLevel, execution, substeps }: { at?: number; since?: number; size: number; minLevel: THaibunLogLevel; execution?: string; substeps: boolean },
): Promise<TRunWindow> {
	const shown = levelsFrom(minLevel);
	// A window shows one execution. Records are read by time, and a device holds the records of more than one run, so
	// what makes a window one run is the execution its ids name: the one requested, else the newest record's, which is
	// the execution a reader following the newest follows. A row that doesn't name an execution is a row of whichever
	// execution is being read: it is kept, and it never names that execution.
	let ofOne = execution;
	const boundToOne = (rows: TRunRow[]): TRunRow[] => {
		if (ofOne === undefined) ofOne = newestExecution(rows);
		const named = (row: TRunRow): string | undefined => row.name?.execution;
		return ofOne === undefined ? rows : rows.filter((row) => named(row) === undefined || named(row) === ofOne);
	};
	const read = async (direction: "before" | "after", limit: number): Promise<TRunRow[]> => {
		if (limit <= 0) return [];
		const perType = await Promise.all(RUN_TYPES.map((type) => side(graph, type, at, direction, limit, shown, substeps)));
		// The store returned the levels requested, so what is left to drop is a record without a time that places it.
		const rows = perType.flatMap((records, i) => records.map((record) => rowOfRecord(itemAt(RUN_TYPES, i).label, record))).filter((r) => !Number.isNaN(r.at));
		rows.sort(inRunOrder);
		return direction === "before" ? rows.slice(-limit) : rows.slice(0, limit);
	};
	// What happened since the last read is what was recorded since it. A record is written after the moment it records,
	// and a step's record is written again when the step ends, so a query by when records were written finds a record
	// of an earlier moment than the newest row held, which a query by the moment records record would pass over for
	// good. Reading the whole window again to find a few new records is what makes following a long run take as long as
	// its whole length.
	if (since !== undefined) {
		const perType = await Promise.all(RUN_TYPES.map((type) => side(graph, { ...type, timeField: RECORDED_AT_TIME_FIELD }, since, "after", size, shown, substeps)));
		const rows = perType.flatMap((records, i) => records.map((record) => rowOfRecord(itemAt(RUN_TYPES, i).label, record))).filter((r) => !Number.isNaN(r.at));
		return windowOf(boundToOne(oneEach(rows)));
	}
	// Where a moment isn't named the window is the live edge, which is the newest records and doesn't extend past them.
	if (at === undefined) return windowOf(boundToOne(await read("before", size)));
	const half = Math.floor(size / 2);
	const [before, after] = await Promise.all([read("before", half), read("after", size - half)]);
	const filled = await toppedUp(before, after, half, size, read);
	return windowOf(boundToOne(oneEach(filled)).slice(0, size));
}
