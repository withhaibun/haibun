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
import { HAIBUN_LOG_LEVELS, type THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { LOG_MESSAGE_FIELD, LOG_MESSAGE_LABEL } from "@haibun/core/lib/log-message.js";
import { SEQ_PATH_FIELD } from "@haibun/core/lib/seq-path.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { queryGraph } from "../quads-snapshot.js";

/** How many records a reader is shown around where they are. */
export const RUN_WINDOW_SIZE = 10000;

/** One thing that happened: a step, or something said while it ran. */
export type TRunRow = {
	kind: "step" | "said";
	/** The step this row is, or the step it was said during. */
	step: string;
	at: number;
	level: THaibunLogLevel;
	/** The step's own text, or what was said. */
	text: string;
	/** A step's outcome, and when it reached it. */
	status?: string;
	endedAt?: number;
};

/** The records a reader is looking at, oldest first, and the moments they span. */
export type TRunWindow = { rows: TRunRow[]; from?: number; to?: number };

const instant = (value: unknown): number => (typeof value === "string" ? Date.parse(value) : typeof value === "number" ? value : Number.NaN);

/** A step, as a row. A step's own level is `info`: what a step said carries its own. */
function stepRow(record: Record<string, unknown>): TRunRow {
	const ended = instant(record[SEQ_PATH_FIELD.endedAtTime]);
	return {
		kind: "step",
		step: String(record[SEQ_PATH_FIELD.id] ?? ""),
		at: instant(record[SEQ_PATH_FIELD.generatedAtTime]),
		level: "info",
		text: String(record[SEQ_PATH_FIELD.stepText] ?? ""),
		...(record[SEQ_PATH_FIELD.actionStatus] === undefined ? {} : { status: String(record[SEQ_PATH_FIELD.actionStatus]) }),
		...(Number.isNaN(ended) ? {} : { endedAt: ended }),
	};
}

/** Something said, as a row. */
function saidRow(record: Record<string, unknown>): TRunRow {
	return {
		kind: "said",
		step: String(record.isPartOf ?? ""),
		at: instant(record[LOG_MESSAGE_FIELD.generatedAtTime]),
		level: (record[LOG_MESSAGE_FIELD.level] as THaibunLogLevel) ?? "info",
		text: String(record[LOG_MESSAGE_FIELD.message] ?? ""),
	};
}

/** The levels at or above the one a reader asked for, which is what a level filter means. */
function atOrAbove(minLevel: THaibunLogLevel): THaibunLogLevel[] {
	return HAIBUN_LOG_LEVELS.slice(HAIBUN_LOG_LEVELS.indexOf(minLevel)) as THaibunLogLevel[];
}

/** One type's records on one side of a moment, in the order they are read from it. */
async function side(label: string, timeField: string, at: number | undefined, direction: "before" | "after", limit: number): Promise<Record<string, unknown>[]> {
	const filters = at === undefined ? [] : [{ predicate: timeField, operator: direction === "before" ? "lt" : "gte", value: new Date(at).toISOString() }];
	const { vertices } = await queryGraph({ label, filters, sortBy: timeField, sortOrder: direction === "before" ? "desc" : "asc", limit, skipCount: true });
	return vertices;
}

/**
 * The window around a moment, or the newest records where no moment is given. `size` is how many records the reader is
 * shown; a level narrows what counts as a record, since a reader asking for warnings is not shown everything under them.
 */
export async function runWindow({ at, size = RUN_WINDOW_SIZE, minLevel = "info" }: { at?: number; size?: number; minLevel?: THaibunLogLevel } = {}): Promise<TRunWindow> {
	const wanted = new Set(atOrAbove(minLevel));
	const read = async (direction: "before" | "after", limit: number): Promise<TRunRow[]> => {
		if (limit <= 0) return [];
		const [steps, said] = await Promise.all([
			side(SEQ_PATH_LABEL, SEQ_PATH_FIELD.generatedAtTime, at, direction, limit),
			side(LOG_MESSAGE_LABEL, LOG_MESSAGE_FIELD.generatedAtTime, at, direction, limit),
		]);
		const rows = [...steps.map(stepRow), ...said.map(saidRow)].filter((r) => wanted.has(r.level) && !Number.isNaN(r.at));
		rows.sort((a, b) => a.at - b.at);
		return direction === "before" ? rows.slice(-limit) : rows.slice(0, limit);
	};
	// No moment named is the live edge, which is the newest records and nothing after them.
	if (at === undefined) {
		const rows = await read("before", size);
		return { rows, ...(rows.length ? { from: rows[0].at, to: rows[rows.length - 1].at } : {}) };
	}
	const half = Math.floor(size / 2);
	const [before, after] = await Promise.all([read("before", half), read("after", size - half)]);
	// A side that runs short is made up by the other, so a window is the size asked for wherever the run holds it.
	const short = size - before.length - after.length;
	const filled = short > 0 ? (before.length < half ? [...before, ...after, ...(await read("after", size - half + short)).slice(after.length)] : [...(await read("before", half + short)).slice(0, short), ...before, ...after]) : [...before, ...after];
	const rows = [...new Map(filled.map((r) => [`${r.kind}|${r.step}|${r.at}|${r.text}`, r])).values()].sort((a, b) => a.at - b.at).slice(0, size);
	return { rows, ...(rows.length ? { from: rows[0].at, to: rows[rows.length - 1].at } : {}) };
}
