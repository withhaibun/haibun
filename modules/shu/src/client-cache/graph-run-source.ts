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
 * The window re-reads when the run says something changed. A view therefore holds what a reader is looking at rather
 * than everything that has happened, which is what keeps a run of years readable.
 */
import type { THaibunLogLevel } from "@haibun/core/schema/protocol.js";
import { subscribeBatchedEvents } from "../event-stream.js";
import { getWindowSize } from "../window-size-setting.js";
import type { Range } from "../ranges.js";
import type { TScrollMarker } from "../scrollbar-model.js";
import { RUN_WINDOW_SIZE, runWindow, type TRunRow } from "./run-window.js";
import type { RunSource, TEventRecord, TRunExtent } from "./run-source.js";

/** How long a burst of changes is collected before the window is read again. */
export const RE_READ_AFTER_MS = 250;

/** A row as a view renders it. A step carries how it went and how long it took; what was said carries its own level. */
function asRendered(row: TRunRow): TEventRecord {
	const seqPath = row.step ? row.step.split(".").map(Number).filter((n) => !Number.isNaN(n)) : undefined;
	if (row.kind === "said") return { id: row.step, kind: "log", level: row.level, message: row.text, timestamp: row.at, seqPath };
	return {
		id: row.step,
		kind: "lifecycle",
		type: "step",
		stage: "end",
		level: row.level,
		in: row.text,
		actionName: row.text,
		status: row.status,
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
export function graphRunSource(level: THaibunLogLevel, { size = RUN_WINDOW_SIZE, reReadAfterMs = RE_READ_AFTER_MS }: { size?: number; reReadAfterMs?: number } = {}): RunSource & { readAt(at?: number): Promise<void> } {
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

	const read = async (): Promise<void> => {
		const window = await runWindow({ at, size, minLevel: level });
		rows = window.rows.map(asRendered);
		extent = { total: rows.length, ...(window.from === undefined ? {} : { first: window.from }), ...(window.to === undefined ? {} : { last: window.to }) };
		loaded = true;
		notify();
	};

	// What the run says has changed is what makes the window stale; a burst of changes reads it once.
	const unsubscribe = subscribeBatchedEvents({
		onBatch: () => {
			if (due) return;
			due = setTimeout(() => {
				due = null;
				void read();
			}, reReadAfterMs);
		},
	});

	const source: RunSource & { readAt(at?: number): Promise<void>; close(): void } = {
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
			return read();
		},
		subscribe: (fn: () => void) => {
			subs.add(fn);
			return () => subs.delete(fn);
		},
		close: () => {
			unsubscribe();
			if (due) clearTimeout(due);
		},
	};
	return source;
}
