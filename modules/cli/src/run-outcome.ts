/**
 * What a supervised run says about itself, accrued from its output as that output arrives.
 *
 * A run reports its lifecycle as one JSON object per line: the same events a serving instance offers over SSE,
 * carrying seqPaths, outcomes and artifact paths, which console prose does not. The accrual happens where every
 * chunk is received, because a bounded tail read after the fact has only what was left, and a chatty run outruns
 * any tail worth keeping.
 */
import { formatSeqPath } from "@haibun/core/lib/seq-path.js";
import { LIFECYCLE_STATUS, isHandedOutEvent, isSpeculativeEvent } from "@haibun/core/schema/protocol.js";

/**
 * A run's own lifecycle events, as they arrive on its output.
 *
 * A supervised run writes its events as one JSON object per line, which is the same stream a serving instance offers
 * over SSE, carrying seqPaths, outcomes and artifact paths, which console prose does not. So a run this process
 * forked is watched by reading its output; `SseSubscriber` is for a run this process did not fork and can only reach
 * over its endpoint. One set of events, two ways in, no second vocabulary.
 */
export type TRunEvent = {
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

/** One line of a run's output as an event, or nothing when the line is the run's console prose. */
function eventOf(line: string): TRunEvent | undefined {
	const start = line.indexOf("{");
	if (start < 0 || !line.trimEnd().endsWith("}")) return undefined;
	try {
		const parsed = JSON.parse(line.slice(start)) as TRunEvent;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		// a line that begins with a brace and is not an event is prose; the run's own report holds the whole of it
		return undefined;
	}
}

/** The events in a stretch of a run's output. Lines that are not events are the run's console prose, and are skipped. */
export function runEvents(output: string): TRunEvent[] {
	return output.split("\n").flatMap((line): TRunEvent[] => {
		const event = eventOf(line);
		return event ? [event] : [];
	});
}

/** A step the run reported as failed: where it was, what it was, and what it said. */
export type TRunFailure = { seqPath: string; step: string; message: string };

/** One feature of a run: what it was, and what became of it. A run's story is its features, not its total. */
export type TRunFeature = { id: string; name: string; path: string; steps: number; failed: number };

/**
 * What a run says about itself: how it ended, what failed, and where it wrote its report. All of it comes from the
 * run's own events, which it reports because it was started to be read (see `runEnvironment`).
 *
 * The outcome is the run's `execution` end event, which is the run's own verdict on the whole of itself. The failures
 * are its `step` end events that did not complete, each carrying the seqPath it failed at. The report is the HTML
 * artifact it wrote, named by the event that wrote it.
 */
/** What a run has said about itself so far. Reduced from its output as that arrives, since a long run's earliest
 *  lines fall out of the tail before it ends, and a count taken at the end would be a count of what was left. */
export type TRunOutcome = {
	features: Map<string, TRunFeature>;
	steps: number;
	failures: TRunFailure[];
	report: string;
	summary: string;
	pending: string;
	current?: string;
	/** Whether the run has reported that its features are over. A run left standing says this and then keeps serving,
	 *  so it is what "the run is done" means for a run that will not exit. */
	finished: boolean;
	/** Whether it said they were over having completed. */
	succeeded: boolean;
};

export const emptyOutcome = (): TRunOutcome => ({
	features: new Map(),
	steps: 0,
	failures: [],
	report: "",
	summary: "the run reported no outcome",
	pending: "",
	finished: false,
	succeeded: false,
});

/**
 * Reduce a stretch of a run's output into what it has said so far.
 *
 * A read ends wherever the run had got to, which is usually mid-line, so the unfinished line is held and joined to
 * the next read. Without that, every event straddling a read boundary is lost, and what is lost is invisible.
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
		// A feature is reported when it starts, and the same start is printed once as an event and once by whatever
		// formats the console, so features are held by their identity rather than by their lines. What follows a start
		// belongs to that feature, since a feature reports no end.
		if (event.type === "feature") {
			const id = String(event.id ?? event.featurePath ?? outcome.features.size);
			outcome.current = id;
			if (!outcome.features.has(id))
				outcome.features.set(id, { id, name: String(event.featureName ?? event.feature ?? id), path: String(event.featurePath ?? ""), steps: 0, failed: 0 });
		}
		if (event.stage !== "end") continue;
		if (event.type === "execution") {
			outcome.summary = `the run ${event.status === LIFECYCLE_STATUS.completed ? "completed" : String(event.status ?? "ended")}`;
			outcome.finished = true;
			outcome.succeeded = event.status === LIFECYCLE_STATUS.completed;
		}
		if (event.type !== "step") continue;
		outcome.steps += 1;
		const feature = outcome.current ? outcome.features.get(outcome.current) : undefined;
		if (feature) feature.steps += 1;
		// A step the run did not expect to pass is not a failure of the run: a speculative step is asked in case it
		// applies, and a handed-out call fails back to whoever made it. The run's own summary counts neither.
		if (event.status === LIFECYCLE_STATUS.completed || isSpeculativeEvent(event) || isHandedOutEvent(event)) continue;
		if (feature) feature.failed += 1;
		outcome.failures.push({ seqPath: formatSeqPath(event.seqPath ?? []), step: String(event.in ?? ""), message: String(event.message ?? event.error ?? "") });
	}
	// A run whose report is only announced in its log, rather than emitted as an artifact, still says where it is.
	const announced = output.match(/(file:\/\/\S+\.html)/g);
	if (announced) outcome.report = announced[announced.length - 1];
	return outcome;
}

/** The whole of a run's output, read at once: what an examine of a finished run reads. */
export function examineRun(output: string): { failures: TRunFailure[]; report: string; steps: number; features: TRunFeature[]; summary: string } {
	// A whole output ends where the run ended, so the last line is complete: accruing it with a trailing newline
	// leaves nothing pending.
	const { features, steps, failures, report, summary } = accrueRunOutcome(emptyOutcome(), `${output}\n`);
	return { failures, report, steps, features: [...features.values()], summary };
}
