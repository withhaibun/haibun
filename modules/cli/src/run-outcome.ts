/**
 * Accrues a supervised run's outcome from its output as each chunk arrives.
 *
 * A supervised run writes each lifecycle event as one JSON object per line. These are the events a serving instance
 * sends over SSE. They carry seqPaths, outcomes and artifact paths. Console prose doesn't carry them. Each chunk is
 * accrued as it arrives, because a bounded tail read afterwards holds only the latest output. A verbose run's output
 * exceeds any bounded tail.
 */
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { LIFECYCLE_STATUS, isHandedOutEvent, isSpeculativeEvent } from "@haibun/core/schema/protocol.js";

/**
 * One event from a supervised run's output.
 *
 * This process reads the output of a run it forked. `SseSubscriber` reads the events of a run that this process didn't
 * fork. It reads them from that run's endpoint. Both read the same events.
 */
type TRunEvent = {
	id?: string;
	kind?: string;
	stage?: string;
	status?: string;
	type?: string;
	in?: string;
	seqPath?: number[];
	message?: string;
	artifactType?: string;
	intent?: { mode?: string };
	[k: string]: unknown;
};

/** Parses one line of a run's output as an event. Returns undefined for a line of console prose. */
function eventOf(line: string): TRunEvent | undefined {
	const start = line.indexOf("{");
	if (start < 0 || !line.trimEnd().endsWith("}")) return undefined;
	try {
		const parsed = JSON.parse(line.slice(start)) as TRunEvent;
		return parsed && typeof parsed === "object" ? parsed : undefined;
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

/** A step a supervised run reported as failed: its seqPath, its text and its message. */
type TRunFailure = { seqPath: string; step: string; message: string };

/** One feature of a run: its id, name and path, its step count and its failed step count. TRunOutcome holds each
 *  feature as well as the totals. */
type TRunFeature = { id: string; name: string; path: string; steps: number; failed: number };

/**
 * What a supervised run has emitted so far: its features, its step count, the steps that failed, its summary and its
 * report path. Each field comes from its output. A run that InstanceStepper starts emits events because
 * `runEnvironment` sets NDJSON output.
 *
 * The summary comes from the `execution` end event. The failures are the `step` end events that didn't complete, other
 * than speculative steps and handed-out calls. Each failure holds its step's seqPath. The report is the path in the
 * latest HTML artifact event, or the last HTML file URL in the output.
 */
export type TRunOutcome = {
	features: Map<string, TRunFeature>;
	steps: number;
	failures: TRunFailure[];
	report: string;
	summary: string;
	pending: string;
	current?: string;
	/** Whether a run has emitted its `execution` end event. A standing run emits it and keeps serving without exiting.
	 *  This field then marks the end of its features. */
	finished: boolean;
	/** Whether the `execution` end event's status is completed. */
	succeeded: boolean;
};

export const emptyOutcome = (): TRunOutcome => ({
	features: new Map(),
	steps: 0,
	failures: [],
	report: "",
	summary: "the test run didn't report an outcome",
	pending: "",
	finished: false,
	succeeded: false,
});

/**
 * Accrues a chunk of a run's output into its outcome.
 *
 * A read usually ends mid-line. The unfinished line is held in `pending` and joined to the next read. Without
 * `pending`, an event that spans two reads would be dropped without an error.
 */
export function accrueRunOutcome(outcome: TRunOutcome, output: string): TRunOutcome {
	const lines = (outcome.pending + output).split("\n");
	outcome.pending = lines.pop() ?? "";
	for (const event of lines.flatMap((line): TRunEvent[] => {
		const parsed = eventOf(line);
		return parsed ? [parsed] : [];
	})) {
		if (event.kind === "artifact" && event.artifactType === "html" && typeof event.path === "string") outcome.report = event.path;
		if (event.kind !== "lifecycle") continue;
		// A feature start appears twice: once as an event and once from the console formatter. Features are keyed by id,
		// else by featurePath, so the second appearance doesn't add a feature. A feature doesn't emit an end event, so
		// each step counts toward the feature that started last.
		if (event.type === "feature") {
			const id = String(event.id ?? event.featurePath ?? outcome.features.size);
			outcome.current = id;
			if (!outcome.features.has(id))
				outcome.features.set(id, { id, name: String(event.featureName ?? event.feature ?? id), path: String(event.featurePath ?? ""), steps: 0, failed: 0 });
		}
		if (event.stage !== "end") continue;
		if (event.type === "execution") {
			outcome.summary = `the test run ${event.status === LIFECYCLE_STATUS.completed ? "completed" : String(event.status ?? "ended")}`;
			outcome.finished = true;
			outcome.succeeded = event.status === LIFECYCLE_STATUS.completed;
		}
		if (event.type !== "step") continue;
		outcome.steps += 1;
		const feature = outcome.current ? outcome.features.get(outcome.current) : undefined;
		if (feature) feature.steps += 1;
		// A failed speculative step or handed-out call isn't a failure of the supervised run. A speculative step is tried
		// in case it applies. A handed-out call returns its failure to its caller. The supervised run's own status doesn't
		// count them as failures either.
		if (event.status === LIFECYCLE_STATUS.completed || isSpeculativeEvent(event) || isHandedOutEvent(event)) continue;
		if (feature) feature.failed += 1;
		outcome.failures.push({ seqPath: formatSeqPath(event.seqPath ?? []), step: String(event.in ?? ""), message: String(event.message ?? event.error ?? "") });
	}
	// A run that writes its report path only to a log line doesn't emit an artifact event. The last HTML file URL in
	// this chunk sets the report.
	const announced = output.match(/(file:\/\/\S+\.html)/g);
	const report = announced?.at(-1);
	if (report) outcome.report = report;
	return outcome;
}

/** Reads a finished run's whole output at once and returns its outcome. */
export function examineRun(output: string): { failures: TRunFailure[]; report: string; steps: number; features: TRunFeature[]; summary: string } {
	// A finished run's output ends with a complete line. The appended newline keeps that line out of `pending`.
	const { features, steps, failures, report, summary } = accrueRunOutcome(emptyOutcome(), `${output}\n`);
	return { failures, report, steps, features: [...features.values()], summary };
}
