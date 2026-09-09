/**
 * The run as a reader is looking at it: the records around a moment, in order.
 *
 * A run is in the graph. A step is a `SeqPath` individual and what it said is a `LogMessage` individual pointing back
 * at it, so reading the run is a query over those two types by time, not a second history to keep. What a reader sees
 * is a window of a stated number of records around where they are, which is what keeps the cost of looking the same
 * whether the run has lasted an hour or a decade: the window is read by time, and within it a page is an offset that
 * can never exceed the window.
 *
 * A window at the live edge is the newest records; one around a moment is half before it and half after, and where a
 * side runs short the other side makes up the difference, so a window is always the size that was asked for when the
 * run holds that many.
 */
import { GraphQuerySchema } from "@haibun/core/lib/quad-types.js";
import { HAIBUN_LOG_LEVELS, SUBSTEP_LEVEL, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_FIELD, RUN_ARTIFACT_LABEL } from "@haibun/core/lib/run-artifact.js";
import { RECORDED_AT_TIME_FIELD, SEQ_PATH_EDGE, SEQ_PATH_FIELD, compareSeqPath, parseRecordName, type TRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import type { TRunGraph } from "./run-graph.js";

/** How many records a reader is shown around where they are. */
export const RUN_WINDOW_SIZE = 10000;

/** One thing that happened: a step, something said while it ran, or something it produced. */
export type TRunRow = {
	kind: "step" | "said" | "produced";
	/** The step this row is, or the step it was said during, and its path within the execution. */
	step: string;
	under?: number[];
	at: number;
	level: THaibunLogLevel;
	/** The step's own text, or what was said. */
	text: string;
	/** What the step called: the stepper and the action within it. The text says what was asked for; this says what ran. */
	called?: string;
	/** When this record was written, or last written again: what a reader following the run asks for what happened
	 *  since by. Absent on a record written before it was declared. */
	recordedAt?: number;
	/** What this step produced, named on the row a reader sees rather than on rows of its own: a run records a
	 *  produced thing under the step that made it, and that step can be part of the machinery a reader is not reading. */
	produced?: TRunRow[];
	/** The step whose row carries this produced thing, where one in the window claims it. A view showing rows of steps
	 *  draws it there and gives this row no room; a view reading the run's own document places it by its own reading. */
	carriedBy?: string;
	/** The step this one was run to carry out, on a substep: the step that established it, as its path within the
	 *  execution. A reader shown a substep is shown which step ran it, and reads that step from here. */
	partOf?: number[];
	/** A step's outcome, why it failed where it did, and when it reached it. */
	status?: string;
	error?: string;
	/** The view this step showed, by the name the site declares it under. */
	showed?: string;
	endedAt?: number;
	/** How a step reached what ran it, and the host that ran it where another one did. */
	ranVia?: string;
	ranOn?: string;
	/** What a step had to hold to run, what the caller held, and who they were. */
	capabilityAction?: string;
	allowedAction?: string;
	performedBy?: string;
	/** What a produced thing is and where it is: an artifact is a file, and a row of it points at that file. */
	artifactType?: string;
	path?: string;
	featureRelativePath?: string;
	mediaType?: string;
	/** This record's own name, as written and as read: a step's is the step; what it said or produced is named under it.
	 *  Read once here, so nothing that orders, groups or shows a row parses the same id again. */
	id: string;
	name?: TRecordName;
	/** The record this row is of, and the type it is one of: what a page holds when it holds what it has read. */
	record: Record<string, unknown>;
	label: string;
};

/** The records a reader is looking at, oldest first, and the moments they span. */
export type TRunWindow = { rows: TRunRow[]; from?: number; to?: number };

/** Where a row of one kind sits among the rows of one step: the step itself, then what it said, then what it produced. */
const KIND_ORDER: Record<TRunRow["kind"], number> = { step: 0, said: 1, produced: 2 };

/**
 * Two rows in the order the run put them: by when; where a clock cannot tell them apart, by their place in the run;
 * within one step, by what the row is and which of those it is.
 *
 * A run outpaces a millisecond, so time alone leaves the rows of one instant in whatever order they were read, and a
 * reader watching the run would see them settle into a different order on the next reading. Every part of a name is
 * compared, so the order is the same however the records were read.
 */
export function inRunOrder(a: TRunRow, b: TRunRow): number {
	if (a.at !== b.at) return a.at - b.at;
	const byPath = compareSeqPath(a.under ?? [], b.under ?? []);
	if (byPath !== 0) return byPath;
	if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
	return (a.name?.ordinal ?? 0) - (b.name?.ordinal ?? 0);
}

const instant = (value: unknown): number => (typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : Number.NaN);

/** One field of a record, where it holds one, under the name a row carries it by. */
const text = (record: Record<string, unknown>, field: string, as: string): Record<string, string> => (typeof record[field] === "string" ? { [as]: record[field] } : {});

/** When a record was written, where it says. */
const recorded = (record: Record<string, unknown>): { recordedAt?: number } => {
	const at = instant(record[RECORDED_AT_TIME_FIELD]);
	return Number.isNaN(at) ? {} : { recordedAt: at };
};

/** A step, as a row. A step's own level is `info`: what a step said carries its own. */
function stepRow(record: Record<string, unknown>): TRunRow {
	const ended = instant(record[SEQ_PATH_FIELD.endedAtTime]);
	const id = String(record[SEQ_PATH_FIELD.id] ?? "");
	const name = parseRecordName(id);
	const level = (record[SEQ_PATH_FIELD.level] as THaibunLogLevel) ?? "info";
	// A step run to carry another one out reports at the level substeps report at, which is what SUBSTEP_LEVEL is: the
	// record says a step is a substep by the level it reports at, so which step established it is read for those alone.
	const partOf = level === SUBSTEP_LEVEL ? parseRecordName(String(record[SEQ_PATH_EDGE.isPartOf] ?? ""))?.path : undefined;
	return {
		kind: "step",
		record,
		label: SEQ_PATH_LABEL,
		id,
		...(name === undefined ? {} : { name, under: name.path }),
		step: id,
		at: instant(record[SEQ_PATH_FIELD.generatedAtTime]),
		...recorded(record),
		level,
		...(partOf === undefined ? {} : { partOf }),
		text: String(record[SEQ_PATH_FIELD.stepText] ?? ""),
		...(record[SEQ_PATH_FIELD.actionStatus] === undefined ? {} : { status: String(record[SEQ_PATH_FIELD.actionStatus]) }),
		...(Number.isNaN(ended) ? {} : { endedAt: ended }),
		...text(record, SEQ_PATH_FIELD.error, "error"),
		...text(record, SEQ_PATH_FIELD.showed, "showed"),
		...text(record, SEQ_PATH_FIELD.called, "called"),
		...text(record, SEQ_PATH_FIELD.ranVia, "ranVia"),
		...text(record, SEQ_PATH_FIELD.ranOn, "ranOn"),
		...text(record, SEQ_PATH_FIELD.capabilityAction, "capabilityAction"),
		...text(record, SEQ_PATH_FIELD.allowedAction, "allowedAction"),
		...text(record, "performedBy", "performedBy"),
	};
}

/** Something said, as a row. What is said during a step belongs to that step; what is said outside every step, which
 *  is where a run says what went wrong after a step ended, belongs to the run by its own name. */
function saidRow(record: Record<string, unknown>): TRunRow {
	const id = String(record[LOG_MESSAGE_FIELD.id] ?? "");
	const step = String(record.isPartOf ?? id);
	const name = parseRecordName(id);
	return {
		kind: "said",
		record,
		label: LOG_MESSAGE_LABEL,
		id,
		...(name === undefined ? {} : { name, under: parseRecordName(step)?.path ?? name.path }),
		step,
		at: instant(record[LOG_MESSAGE_FIELD.generatedAtTime]),
		...recorded(record),
		level: (record[LOG_MESSAGE_FIELD.level] as THaibunLogLevel) ?? "info",
		text: String(record[LOG_MESSAGE_FIELD.message] ?? ""),
	};
}

/** Something produced, as a row. What a run produced as its work reports where its steps do; a trace of the run's own
 *  machinery reports under them, which is what its level says. */
function producedRow(record: Record<string, unknown>): TRunRow {
	const id = String(record[RUN_ARTIFACT_FIELD.id] ?? "");
	const step = String(record.isPartOf ?? id);
	const name = parseRecordName(id);
	return {
		kind: "produced",
		record,
		label: RUN_ARTIFACT_LABEL,
		id,
		...(name === undefined ? {} : { name, under: parseRecordName(step)?.path ?? name.path }),
		step,
		at: instant(record[RUN_ARTIFACT_FIELD.generatedAtTime]),
		...recorded(record),
		level: (record[RUN_ARTIFACT_FIELD.level] as THaibunLogLevel) ?? "info",
		text: String(record[RUN_ARTIFACT_FIELD.artifactType] ?? ""),
		...text(record, RUN_ARTIFACT_FIELD.artifactType, "artifactType"),
		...text(record, RUN_ARTIFACT_FIELD.path, "path"),
		...text(record, RUN_ARTIFACT_FIELD.featureRelativePath, "featureRelativePath"),
		...text(record, RUN_ARTIFACT_FIELD.mediaType, "mediaType"),
	};
}

/** One record as the row it is, whichever type it is: the one place a record becomes a row. */
export function rowOfRecord(label: string, record: Record<string, unknown>): TRunRow {
	if (label === LOG_MESSAGE_LABEL) return saidRow(record);
	if (label === RUN_ARTIFACT_LABEL) return producedRow(record);
	return stepRow(record);
}

/** Each record once, in the order the run put them: two readings of one record are one row. */
function oneEach(rows: TRunRow[]): TRunRow[] {
	return [...new Map(rows.map((r) => [r.id, r])).values()].sort(inRunOrder);
}

/**
 * What a step produced, named on the row of the step a reader sees.
 *
 * A run records a produced thing under the step that made it, and that step is often part of the machinery: a
 * screenshot taken after every step is recorded under a step of its own. A reader reads the step they wrote, so the
 * shot is claimed by the nearest step among the rows of the window, and that step's row says it carries it. The row
 * itself stays in the window, because a window is one reading that every view reads: a view of the run's steps draws
 * the shot on the step's row, and the run's document places it where its own reading puts it. A produced thing whose
 * step is not among the rows is claimed by nothing and is read as the row it is.
 */
export function producedUnderSteps(rows: TRunRow[]): TRunRow[] {
	const byPath = new Map<string, TRunRow>();
	// A row is the same object across reads, and a step's shot can be recorded after the step: each pass says what the
	// rows of this window hold rather than adding to what an earlier pass over other rows said.
	for (const row of rows) {
		if (row.kind === "produced") row.carriedBy = undefined;
		if (row.kind === "step" && row.name) {
			row.produced = undefined;
			byPath.set(row.name.path.join("."), row);
		}
	}
	for (const row of rows) {
		if (row.kind !== "produced") continue;
		const under = row.under ?? row.name?.path ?? [];
		let host: TRunRow | undefined;
		for (let i = under.length; i > 0 && host === undefined; i--) host = byPath.get(under.slice(0, i).join("."));
		if (host === undefined) continue;
		host.produced = [...(host.produced ?? []), row];
		row.carriedBy = host.step;
	}
	return rows;
}

/** A window and the moments it spans: its first and last row's instants. */
function windowOf(rows: TRunRow[]): TRunWindow {
	const held = producedUnderSteps(rows);
	return { rows: held, ...(held.length ? { from: held[0].at, to: held[held.length - 1].at } : {}) };
}

/** The execution of the newest row that names one, which is the run a window of these rows is of. */
function newestExecution(rows: TRunRow[]): string | undefined {
	for (let i = rows.length - 1; i >= 0; i--) if (rows[i].name) return rows[i].name?.execution;
	return undefined;
}

/** A side that runs short is made up by the other, so a window is the size asked for wherever the run holds it. */
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

/** The types a run's records are read from, each with the field that places one in time. What a reader is shown of a
 *  run, what the shape of a run is drawn from and what a device forgets when it forgets a run are the same records, so
 *  all of them read this. */
export const RUN_TYPES: ReadonlyArray<{ label: string; timeField: string }> = [
	{ label: SEQ_PATH_LABEL, timeField: SEQ_PATH_FIELD.generatedAtTime },
	{ label: LOG_MESSAGE_LABEL, timeField: LOG_MESSAGE_FIELD.generatedAtTime },
	{ label: RUN_ARTIFACT_LABEL, timeField: RUN_ARTIFACT_FIELD.generatedAtTime },
];

/** The levels at or above the one a reader asked for, which is what a level filter means. */
function atOrAbove(minLevel: THaibunLogLevel): THaibunLogLevel[] {
	return HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel)) as THaibunLogLevel[];
}

/** The field every record states how prominently it reports by, which is the filter a level is. */
const LEVEL = "level";

/**
 * One type's records on one side of a moment, at the levels a reader is shown, in the order they are read from it.
 *
 * A level is asked of the store rather than filtered out after reading: a record states its level, so a view showing
 * three of them asks for those three. Reading every record of every level to drop most of them is what makes a view of
 * a chatty run read the whole run.
 */
async function side(
	graph: TRunGraph,
	label: string,
	timeField: string,
	at: number | undefined,
	direction: "before" | "after",
	limit: number,
	levels: readonly THaibunLogLevel[],
	offset = 0,
	// Which end of the side to read from: the records nearest the moment, or, reading the other way, the furthest. A
	// side with fewer records than a reader asked for is bounded by its furthest, which is one read rather than a count.
	order: "nearest" | "furthest" = "nearest",
	// Whether the reader asked for the steps run to carry other steps out.
	substeps = false,
): Promise<Record<string, unknown>[]> {
	// A graph that does not carry a type holds none of it, so asking for it would be asking a question with no answer.
	if (!graph.declares(label)) return [];
	const when = at === undefined ? [] : [{ predicate: timeField, operator: direction === "before" ? "lt" : "gte", value: new Date(at).toISOString() }];
	// Which levels this type is read at, which is not always the levels the reader chose. A produced thing is read
	// whatever it reports at, because the row of the step that produced it is what shows it. A reader asking for the
	// steps run to carry other steps out reads the level those report at as well, for the steps alone: what a substep
	// said carries its own level and is read at the level the reader chose. Every read of a type comes through here, so
	// the rule is stated once and the extent, the region and the window cannot read a type differently.
	const read = label === SEQ_PATH_LABEL && substeps && !levels.includes(SUBSTEP_LEVEL) ? [...levels, SUBSTEP_LEVEL] : levels;
	const shown = label === RUN_ARTIFACT_LABEL ? [] : [{ predicate: LEVEL, operator: "in", value: read[0], values: [...read] }];
	const nearestFirst = direction === "before" ? "desc" : "asc";
	const sortOrder = order === "nearest" ? nearestFirst : nearestFirst === "desc" ? "asc" : "desc";
	const { vertices } = await graph.query(GraphQuerySchema.parse({ label, filters: [...when, ...shown], sortBy: timeField, sortOrder, limit, offset, skipCount: true }));
	return vertices;
}

/**
 * How far a run reaches: its first and last instants, over every kind of record it writes.
 *
 * Read rather than inferred from the part of it a reader holds. A window is a few thousand records however long the
 * run is, so a span taken from the window is the window's span; a bar drawn over that would show a decade's run as the
 * few minutes a reader happens to be looking at. Two records are read per type, each the first or last of its own
 * order, so the cost does not grow with the run.
 *
 * Both zero for a run that has written nothing, which is a run with no span rather than a failure.
 */
export async function runExtent(graph: TRunGraph, minLevel: THaibunLogLevel = "info"): Promise<{ first: number; last: number }> {
	const levels = atOrAbove(minLevel);
	const ends = await Promise.all(
		RUN_TYPES.map(async (type) => ({
			// No moment named is the whole of it: the oldest record read forward, the newest read back.
			first: await instantAt(graph, type, undefined, "after", 0, levels),
			last: await instantAt(graph, type, undefined, "before", 0, levels),
		})),
	);
	const firsts = ends.map((e) => e.first).filter((f): f is number => f !== undefined);
	const lasts = ends.map((e) => e.last).filter((l): l is number => l !== undefined);
	return firsts.length && lasts.length ? { first: Math.min(...firsts), last: Math.max(...lasts) } : { first: 0, last: 0 };
}

/** How many records a reader is shown in detail to each side of where they are. */
export const DETAIL_HALF = 5000;

/** The instant of one record on one side of a moment, that many records along, or undefined where the side holds
 *  fewer. One row read at an offset, so finding it costs the same whatever it is reaching past. With no moment named,
 *  the whole of the type is the side. */
async function instantAt(
	graph: TRunGraph,
	type: { label: string; timeField: string },
	at: number | undefined,
	direction: "before" | "after",
	offset: number,
	levels: readonly THaibunLogLevel[],
	order: "nearest" | "furthest" = "nearest",
): Promise<number | undefined> {
	const [record] = await side(graph, type.label, type.timeField, at, direction, 1, levels, offset, order);
	if (!record) return undefined;
	const found = instant(record[type.timeField]);
	return Number.isNaN(found) ? undefined : found;
}

/**
 * The span a reader is shown in detail: the records around where they are, counted rather than measured.
 *
 * Detail holds the same number of records however busy the run is, so its span in time narrows over a busy period and
 * widens over a quiet one, which is what makes it a fisheye rather than a zoom. Where one side holds fewer than its
 * share, that share goes to the other, so a reader at the live edge is shown the whole region behind them.
 *
 * Each bound is one record read at an offset, per type, so finding the span costs the same whatever it spans. The span
 * reaches as far as any type's own bound, since a type cut short of its share would be missing from what is drawn.
 */
export async function detailRegion(graph: TRunGraph, { at, half = DETAIL_HALF, minLevel = "info" }: { at: number; half?: number; minLevel?: THaibunLogLevel }): Promise<{ from: number; to: number }> {
	const shown = atOrAbove(minLevel);
	const bounds = await Promise.all(
		RUN_TYPES.map(async (type) => {
			const [back, forward] = await Promise.all([instantAt(graph, type, at, "before", half - 1, shown), instantAt(graph, type, at, "after", half - 1, shown)]);
			// A side holding fewer than its share is bounded by its furthest record, and the other side reads on for
			// what it did not use, so the region holds what was asked for wherever the run has it.
			const from = back ?? (await instantAt(graph, type, at, "before", 0, shown, "furthest"));
			const to = forward ?? (await instantAt(graph, type, at, "after", 0, shown, "furthest"));
			if (back === undefined && to !== undefined) return { from, to: (await instantAt(graph, type, at, "after", 2 * half - 1, shown)) ?? to };
			if (forward === undefined && from !== undefined) return { from: (await instantAt(graph, type, at, "before", 2 * half - 1, shown)) ?? from, to };
			return { from, to };
		}),
	);
	const froms = bounds.map((b) => b.from).filter((f): f is number => f !== undefined);
	const tos = bounds.map((b) => b.to).filter((t): t is number => t !== undefined);
	return { from: froms.length ? Math.min(...froms) : at, to: tos.length ? Math.max(...tos) : at };
}

/**
 * The window around a moment, or the newest records where no moment is given, or, with `since`, what was recorded
 * since that instant. `size` is how many records the reader is shown; a level narrows what counts as a record, since a
 * reader asking for warnings is not shown everything under them.
 */
export async function runWindow(
	graph: TRunGraph,
	{ at, since, size = RUN_WINDOW_SIZE, minLevel = "info", execution, substeps = false }: { at?: number; since?: number; size?: number; minLevel?: THaibunLogLevel; execution?: string; substeps?: boolean } = {},
): Promise<TRunWindow> {
	const shown = atOrAbove(minLevel);
	// A window is of one execution. Records are read by time, and a device holds the records of more than one run, so
	// what makes a window one run is the execution its ids name: the one asked for, else the one the newest record read
	// belongs to, which is the run a reader following the newest is following. A row that names no execution is a row of
	// whatever run is being read: it is kept, and it never decides which run that is.
	let ofOne = execution;
	const boundToOne = (rows: TRunRow[]): TRunRow[] => {
		if (ofOne === undefined) ofOne = newestExecution(rows);
		const named = (row: TRunRow): string | undefined => row.name?.execution;
		return ofOne === undefined ? rows : rows.filter((row) => named(row) === undefined || named(row) === ofOne);
	};
	const read = async (direction: "before" | "after", limit: number, from: number | undefined = at): Promise<TRunRow[]> => {
		if (limit <= 0) return [];
		const perType = await Promise.all(RUN_TYPES.map((type) => side(graph, type.label, type.timeField, from, direction, limit, shown, 0, "nearest", substeps)));
		// The store answered at the levels asked for, so what is left to drop is a record with no time to place it by.
		const rows = perType.flatMap((records, i) => records.map((record) => rowOfRecord(RUN_TYPES[i].label, record))).filter((r) => !Number.isNaN(r.at));
		rows.sort(inRunOrder);
		return direction === "before" ? rows.slice(-limit) : rows.slice(0, limit);
	};
	// What happened since the last read is what was recorded since it. A record is written after the moment it is of,
	// and a step's record is written again when the step ends, so asking by when records were written finds a record
	// of an earlier moment than the newest row held, which asking by the moment records are of would pass over for
	// good. Reading the whole window again to find a few new records is what makes following a long run cost what the
	// run costs.
	if (since !== undefined) {
		const perType = await Promise.all(RUN_TYPES.map((type) => side(graph, type.label, RECORDED_AT_TIME_FIELD, since, "after", size, shown, 0, "nearest", substeps)));
		const rows = perType.flatMap((records, i) => records.map((record) => rowOfRecord(RUN_TYPES[i].label, record))).filter((r) => !Number.isNaN(r.at));
		return windowOf(boundToOne(oneEach(rows)));
	}
	// No moment named is the live edge, which is the newest records and nothing after them.
	if (at === undefined) return windowOf(boundToOne(await read("before", size)));
	const half = Math.floor(size / 2);
	const [before, after] = await Promise.all([read("before", half), read("after", size - half)]);
	const filled = await toppedUp(before, after, half, size, read);
	return windowOf(boundToOne(oneEach(filled)).slice(0, size));
}
