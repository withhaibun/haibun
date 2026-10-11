/**
 * Actuality's records as the rows a reader reads: a step, what was logged while it ran, and what it produced, each in the
 * order actuality put them, with what a step produced named on the row of the step a reader sees.
 */
import { HAIBUN_LOG_LEVELS, SUBSTEP_LEVEL, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL, LogMessageSchema } from "@haibun/core/lib/log-message.js";
import { RUN_ARTIFACT_FIELD, RUN_ARTIFACT_LABEL, RunArtifactSchema } from "@haibun/core/lib/run-artifact.js";
import { SEQ_PATH_FIELD, SeqPathSchema, compareSeqPath, parseRecordName, type TRecordName } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** How many records a reader is shown around where they are. */
export const RUN_WINDOW_SIZE = 10000;

/** One thing that happened: a step, something logged while it ran, or something it produced. */
export type TRunRow = {
	kind: "step" | "said" | "produced";
	/** The step this row is, or the step it was logged during, and its path within the execution: empty for a record that
	 *  doesn't name a step, which is a record of its execution itself. */
	step: string;
	under: number[];
	at: number;
	level: THaibunLogLevel;
	/** The step's own text, or what was logged. */
	text: string;
	/** What the step called: the stepper and the action within it. The text states the step's words; this states what ran. */
	called?: string;
	/** When this record was written, or last written again: the instant a reader following actuality reads what happened
	 *  since. Absent on a record written before it was declared. */
	recordedAt?: number;
	/** What this step produced, named on the row a reader sees rather than on rows of its own: a run records a
	 *  produced thing under the step that made it, and that step can be part of the machinery a reader is not reading. */
	produced?: TRunRow[];
	/** The step whose row carries this produced thing, where one in the window claims it. A view showing rows of steps
	 *  draws it there and doesn't give this row room; a view reading actuality's own document places it by its own reading. */
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
	/** What a produced thing is and where it is: an artifact is a file, and a row of it points at that file. */
	artifactType?: string;
	path?: string;
	featureRelativePath?: string;
	mediaType?: string;
	/** This record's own name, as written and as read: a step's is the step; what it logged or produced is named under it.
	 *  Read once here, so the code that orders, groups or shows a row doesn't parse the same id again. */
	id: string;
	name?: TRecordName;
	/** The record this row is of, and the type it is one of: what a page holds when it holds what it has read. */
	record: Record<string, unknown>;
	label: string;
};

/** The records a reader is looking at, oldest first, and the moments they span. */
export type TRunWindow = { rows: TRunRow[]; from?: number; to?: number };

/** The place of a row of one kind among the rows of one step: the step itself, then what it logged, then what it produced. */
const KIND_ORDER: Record<TRunRow["kind"], number> = { step: 0, said: 1, produced: 2 };

/**
 * Two rows in the order actuality put them: by when; where a clock reads them as one instant, by their place in actuality;
 * within one step, by what the row is and which of those it is.
 *
 * A run outpaces a millisecond, so time alone leaves the rows of one instant in whatever order they were read, and a
 * reader watching actuality would see them settle into a different order on the next reading. Every part of a name is
 * compared, so the order is the same however the records were read.
 */
export function inRunOrder(a: TRunRow, b: TRunRow): number {
	if (a.at !== b.at) return a.at - b.at;
	const byPath = compareSeqPath(a.under, b.under);
	if (byPath !== 0) return byPath;
	if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
	const [first, second] = [a.name?.ordinal, b.name?.ordinal];
	return first !== undefined && second !== undefined ? first - second : 0;
}

export const instant = (value: unknown): number => (typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : Number.NaN);

/** When a record was written, where it states. */
const recorded = (at: string | undefined): { recordedAt?: number } => {
	const instantOf = instant(at);
	return Number.isNaN(instantOf) ? {} : { recordedAt: instantOf };
};

/** The step a logged or produced record names as its own, else the record itself: what is logged outside every step,
 *  which is where a run reports what went wrong after a step ended, is a record of its execution by its own name. */
const stepOf = (record: Record<string, unknown>, id: string): string => {
	const partOf = record.isPartOf;
	if (partOf === undefined) return id;
	if (typeof partOf !== "string") throw new Error(`the record ${id} names the step it is part of as ${typeof partOf}, not an id`);
	return partOf;
};

/** A record's name and its path: the path of the step it names where it names one, else its own. */
const named = (id: string, step: string): { name?: TRecordName; under: number[] } => {
	const name = parseRecordName(id);
	if (name === undefined) return { under: [] };
	const of = parseRecordName(step);
	return { name, under: of === undefined ? name.path : of.path };
};

/** A step, as a row. */
function stepRow(record: Record<string, unknown>): TRunRow {
	const step = SeqPathSchema.parse(record);
	const ended = instant(step[SEQ_PATH_FIELD.endedAtTime]);
	const level = step[SEQ_PATH_FIELD.level];
	const { name, under } = named(step.id, step.id);
	// A step run to carry another one out reports at the level substeps report at, which is what SUBSTEP_LEVEL is, and
	// its path is the path of the step that ran it with its own index after: the step that established it is read off
	// the path rather than by parsing the edge again.
	const partOf = level === SUBSTEP_LEVEL && under.length > 1 ? under.slice(0, -1) : undefined;
	const status = step[SEQ_PATH_FIELD.actionStatus];
	const error = step[SEQ_PATH_FIELD.error];
	const showed = step[SEQ_PATH_FIELD.showed];
	const called = step[SEQ_PATH_FIELD.called];
	return {
		kind: "step",
		record,
		label: SEQ_PATH_LABEL,
		id: step.id,
		...(name === undefined ? {} : { name }),
		under,
		step: step.id,
		at: instant(step[SEQ_PATH_FIELD.generatedAtTime]),
		...recorded(step[SEQ_PATH_FIELD.recordedAtTime]),
		level,
		...(partOf === undefined ? {} : { partOf }),
		text: step[SEQ_PATH_FIELD.stepText],
		status,
		...(Number.isNaN(ended) ? {} : { endedAt: ended }),
		...(error === undefined ? {} : { error }),
		...(showed === undefined ? {} : { showed }),
		...(called === undefined ? {} : { called }),
	};
}

/** Something logged, as a row. */
function saidRow(record: Record<string, unknown>): TRunRow {
	const said = LogMessageSchema.parse(record);
	const id = said[LOG_MESSAGE_FIELD.id];
	const step = stepOf(record, id);
	const { name, under } = named(id, step);
	return {
		kind: "said",
		record,
		label: LOG_MESSAGE_LABEL,
		id,
		...(name === undefined ? {} : { name }),
		under,
		step,
		at: instant(said[LOG_MESSAGE_FIELD.generatedAtTime]),
		...recorded(said[LOG_MESSAGE_FIELD.recordedAtTime]),
		level: said[LOG_MESSAGE_FIELD.level],
		text: said[LOG_MESSAGE_FIELD.message],
	};
}

/** Something produced, as a row. What a run produced as its work reports where its steps do; a trace of its own
 *  machinery reports under them, which is what its level states. */
function producedRow(record: Record<string, unknown>): TRunRow {
	const made = RunArtifactSchema.parse(record);
	const id = made[RUN_ARTIFACT_FIELD.id];
	const step = stepOf(record, id);
	const { name, under } = named(id, step);
	const path = made[RUN_ARTIFACT_FIELD.path];
	const featureRelativePath = made[RUN_ARTIFACT_FIELD.featureRelativePath];
	const mediaType = made[RUN_ARTIFACT_FIELD.mediaType];
	return {
		kind: "produced",
		record,
		label: RUN_ARTIFACT_LABEL,
		id,
		...(name === undefined ? {} : { name }),
		under,
		step,
		at: instant(made[RUN_ARTIFACT_FIELD.generatedAtTime]),
		...recorded(made[RUN_ARTIFACT_FIELD.recordedAtTime]),
		level: made[RUN_ARTIFACT_FIELD.level],
		text: made[RUN_ARTIFACT_FIELD.artifactType],
		artifactType: made[RUN_ARTIFACT_FIELD.artifactType],
		...(path === undefined ? {} : { path }),
		...(featureRelativePath === undefined ? {} : { featureRelativePath }),
		...(mediaType === undefined ? {} : { mediaType }),
	};
}

/** One record as the row it is, whichever type it is: the one place a record becomes a row. */
export function rowOfRecord(label: string, record: Record<string, unknown>): TRunRow {
	if (label === LOG_MESSAGE_LABEL) return saidRow(record);
	if (label === RUN_ARTIFACT_LABEL) return producedRow(record);
	return stepRow(record);
}

/** Each record once, in the order actuality put them: two readings of one record are one row. */
export function oneEach(rows: TRunRow[]): TRunRow[] {
	return [...new Map(rows.map((r) => [r.id, r])).values()].sort(inRunOrder);
}

/**
 * What a step produced, named on the row of the step a reader sees.
 *
 * A run records a produced thing under the step that made it, and that step is often part of the machinery: a
 * screenshot taken after every step is recorded under a step of its own. A reader reads the step they wrote, so the
 * shot is claimed by the nearest step among the rows of the window, and that step's row states it carries it. The row
 * itself stays in the window, because a window is one reading that every view reads: a view of actuality's steps draws
 * the shot on the step's row, and actuality's document places it where its own reading puts it. A produced thing whose
 * step is not among the rows is unclaimed and is read as the row it is.
 */
export function producedUnderSteps(rows: TRunRow[]): TRunRow[] {
	const byPath = new Map<string, TRunRow>();
	// A row is the same object across reads, and a step's shot can be recorded after the step: each pass states what the
	// rows of this window hold rather than adding to what an earlier pass over other rows stated.
	for (const row of rows) {
		if (row.kind === "produced") row.carriedBy = undefined;
		if (row.kind === "step" && row.name) {
			row.produced = undefined;
			byPath.set(row.name.path.join("."), row);
		}
	}
	const carried = new Map<TRunRow, TRunRow[]>();
	for (const row of rows) {
		if (row.kind !== "produced") continue;
		let host: TRunRow | undefined;
		for (let i = row.under.length; i > 0 && host === undefined; i--) host = byPath.get(row.under.slice(0, i).join("."));
		if (host === undefined) continue;
		const held = carried.get(host);
		if (held === undefined) carried.set(host, [row]);
		else held.push(row);
		row.carriedBy = host.step;
	}
	for (const [host, produced] of carried) host.produced = produced;
	return rows;
}

/** A window and the moments it spans: its first and last row's instants. What a step produced is claimed where the
 *  window is assembled, since one read returns part of it. */
export function windowOf(rows: TRunRow[]): TRunWindow {
	return { rows, ...(rows.length ? { from: itemAt(rows, 0).at, to: itemAt(rows, rows.length - 1).at } : {}) };
}

/** The execution of the newest row that names one, which is the execution a window of these rows shows. */
export function newestExecution(rows: TRunRow[]): string | undefined {
	for (let i = rows.length - 1; i >= 0; i--) {
		const { name } = itemAt(rows, i);
		if (name) return name.execution;
	}
	return undefined;
}

/** The types of a run's records, each with the field that places one in time. What a reader is shown of a run, what
 *  draws the shape of a run and what a device deletes when it deletes a run are the same records, so all of them read
 *  this. */
export type TRunType = {
	label: string;
	timeField: string;
	/** Read whatever it reports at: the row of the step that produced it is what shows it, so the level a reader chose
	 *  states whether that step is shown rather than whether this is read. */
	atEveryLevel?: boolean;
	/** Read at the level substeps report at as well, where a reader asked for the steps run to carry other steps out. */
	widensBySubsteps?: boolean;
};

export const RUN_TYPES: ReadonlyArray<TRunType> = [
	{ label: SEQ_PATH_LABEL, timeField: SEQ_PATH_FIELD.generatedAtTime, widensBySubsteps: true },
	{ label: LOG_MESSAGE_LABEL, timeField: LOG_MESSAGE_FIELD.generatedAtTime },
	{ label: RUN_ARTIFACT_LABEL, timeField: RUN_ARTIFACT_FIELD.generatedAtTime, atEveryLevel: true },
];

/** The levels at or above the one a reader asked for, which is what a level filter means. */
export function levelsFrom(minLevel: THaibunLogLevel): THaibunLogLevel[] {
	return HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel)) as THaibunLogLevel[];
}
