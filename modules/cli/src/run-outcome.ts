/**
 * Reads a supervised run's outcome from its output as each chunk arrives.
 *
 * A supervised run writes each event as one JSON object per line. These are the events a serving instance sends over
 * SSE. Console prose doesn't carry them. Each lifecycle event of a level is a move of the actuality machine, so the
 * outcome is the state the machine reaches over those events: the features, the steps and the failures. Each chunk is
 * read as it arrives, because a bounded tail read afterwards holds only the latest output. A verbose run's output
 * exceeds any bounded tail.
 */
import { z } from "zod";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import {
	ActualityMoveSchema,
	INITIAL_ACTUALITY,
	LEVEL_STATUS,
	executionEnded,
	transition,
	type TActuality,
	type TStepFailure,
} from "@haibun/core/lib/actuality/machines/actuality.js";

/**
 * One event from a supervised run's output, as the fields a reader of its outcome reads.
 *
 * This process reads the output of a run it forked. `SseSubscriber` reads the events of a run that this process didn't
 * fork. It reads them from that run's endpoint. Both read the same events.
 */
const RunEventSchema = z.looseObject({ kind: z.string(), artifactType: z.string().optional(), path: z.unknown().optional() });
type TRunEvent = z.infer<typeof RunEventSchema>;

/** Parses one line of a run's output as an event. Returns undefined for a line of console prose. */
function eventOf(line: string): TRunEvent | undefined {
	const start = line.indexOf("{");
	if (start < 0 || !line.trimEnd().endsWith("}")) return undefined;
	try {
		const parsed = RunEventSchema.safeParse(JSON.parse(line.slice(start)));
		return parsed.success ? parsed.data : undefined;
	} catch {
		// A line that contains `{`, ends with `}` and doesn't parse as JSON is console prose. A supervised run's report holds it.
		return undefined;
	}
}

/** Returns the events in a run's output. Lines of console prose are skipped. */
export function runEvents(output: string): TRunEvent[] {
	return output.split("\n").flatMap((line): TRunEvent[] => {
		const event = eventOf(line);
		return event ? [event] : [];
	});
}

/**
 * What a supervised run has emitted so far: the state the actuality machine reaches over its events, and its report path. A
 * run that InstanceStepper starts emits events because `runEnvironment` sets NDJSON output. The report is the path in the
 * latest HTML artifact event, or the last HTML file URL in the output. `pending` holds the line a read ended within.
 */
export type TRunOutcome = { actuality: TActuality; report?: string; pending: string };

export const emptyOutcome = (): TRunOutcome => ({ actuality: INITIAL_ACTUALITY, pending: "" });

/** A run's summary from its execution's status: how it ended, where its execution has ended. */
export function runSummary(actuality: TActuality): string {
	if (!executionEnded(actuality)) return "the test run didn't report an outcome";
	return `the test run ${actuality.status === LEVEL_STATUS.completed ? "completed" : actuality.status}`;
}

/** A failed step as one line: its id, and its text and its message where its end states them. */
export const failureLine = (failure: TStepFailure): string =>
	[`${failure.id}:`, failure.step, failure.message === undefined ? undefined : `(${failure.message})`].filter((part) => part !== undefined).join(" ");

/**
 * Reads a chunk of a run's output into its outcome.
 *
 * A read usually ends mid-line. The unfinished line is held in `pending` and joined to the next read. Without
 * `pending`, an event that spans two reads would be dropped without an error.
 */
export function readRunOutput(outcome: TRunOutcome, output: string): TRunOutcome {
	const lines = (outcome.pending + output).split("\n");
	// A split returns at least one part, and its last part is the line the read ended within.
	outcome.pending = itemAt(lines, lines.length - 1);
	for (const event of runEvents(lines.slice(0, -1).join("\n"))) {
		if (event.kind === "artifact" && event.artifactType === "html" && typeof event.path === "string") outcome.report = event.path;
		if (event.kind !== "lifecycle") continue;
		// A level's event moves the machine. Another lifecycle type, such as an activity, isn't a move. A feature start
		// appears twice, once as an event and once from the console formatter, and the machine holds the feature once.
		const move = ActualityMoveSchema.safeParse(event);
		if (move.success) outcome.actuality = transition(outcome.actuality, move.data);
	}
	// A run that writes its report path only to a log line doesn't emit an artifact event. The last HTML file URL in
	// this chunk sets the report.
	const announced = output.match(/(file:\/\/\S+\.html)/g);
	const report = announced?.at(-1);
	if (report) outcome.report = report;
	return outcome;
}

/** Reads a finished run's whole output at once and returns its outcome. */
export function examineRun(output: string) {
	// A finished run's output ends with a complete line. The appended newline keeps that line out of `pending`.
	const { actuality, report } = readRunOutput(emptyOutcome(), `${output}\n`);
	return { failures: actuality.failures, report, steps: actuality.steps, features: actuality.features, execution: actuality.status, summary: runSummary(actuality) };
}
