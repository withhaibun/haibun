/**
 * Records the duration of each feature in a run of features. The CLI writes TIMINGS_FILE beside the group's
 * configuration after every run of features. The file is committed with the code. Its git history holds each feature's
 * durations, so the commit that makes a feature slower or faster shows the change.
 *
 * Each feature's entry holds its seconds rounded to a tenth, so two runs whose durations round to the same tenth write
 * the same entry. The entry also holds the number of steps the feature ran and the hash of the text of its declared
 * steps. The hash distinguishes a feature whose declared steps changed from a feature that ran the same steps slower.
 */
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { TExecutorResult } from "@haibun/core/schema/protocol.js";
import { TIMINGS_FILE } from "@haibun/core/lib/util/node/dependency-state.js";

export { TIMINGS_FILE };

/** One feature's timing: the seconds from its first step's start to its last step's end, the number of steps it ran,
 *  and the SHA-256 of the text of the steps it declares. */
const FeatureTimingSchema = z.object({ seconds: z.number(), steps: z.number().int(), declaredStepTextHash: z.string() });
const TimingsSchema = z.object({ features: z.record(z.string(), FeatureTimingSchema), steps: z.number().int(), seconds: z.number() });
type TFeatureTiming = z.infer<typeof FeatureTimingSchema>;
export type TTimings = z.infer<typeof TimingsSchema>;

/** The file holds one set of timings per machine class. A run on other hardware has other durations, and a comparison
 *  across machines reports a difference that a change didn't cause. */
type TTimingsFile = Record<string, unknown>;

/** Returns a key for the class of this machine: its platform, its architecture, its core count and its processor
 *  model. The key describes the hardware and doesn't name the host or the user. */
export function machineKey(): string {
	const cpus = os.cpus();
	const model = (cpus[0]?.model ?? "unknown")
		.toLowerCase()
		.replace(/\((r|tm)\)/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `${os.platform()}-${os.arch()}-${cpus.length || 0}x-${model}`;
}

const tenth = (ms: number): number => Math.round(ms / 100) / 10;

/** Adds totals to a set of feature timings: the sum of their steps and the sum of their seconds in tenths. */
function withTotals(features: Record<string, TFeatureTiming>): TTimings {
	const all = Object.values(features);
	return { features, steps: all.reduce((sum, f) => sum + f.steps, 0), seconds: Math.round(all.reduce((sum, f) => sum + f.seconds * 10, 0)) / 10 };
}

/** Computes each feature's timing from its result's step summary and declared step text hash. A long feature's result
 *  holds only its most recent step results. The step summary's count, first start and last end still cover every step. */
export function timingsOf(result: TExecutorResult): TTimings {
	const features: Record<string, TFeatureTiming> = {};
	for (const feature of result.featureResults ?? []) {
		const { count, firstStart, lastEnd } = feature.steps;
		const took = firstStart !== undefined && lastEnd !== undefined ? lastEnd - firstStart : 0;
		features[feature.path] = { seconds: tenth(took), steps: count, declaredStepTextHash: feature.declaredStepTextHash };
	}
	return withTotals(features);
}

/** The smallest change to report. A feature is reported where its duration differs from the recorded run by at least
 *  a fifth of the recorded duration and by at least a second. Three runs of one group recorded 6.2, 6.3 and 6.3 seconds
 *  for its largest feature, so a fifth exceeds the spread between runs of unchanged code. The one-second minimum keeps
 *  a short feature's small changes out of the report. */
const CHANGED_FRACTION = 0.2;
const CHANGED_SECONDS = 1;

/** A feature whose duration differs from the recorded run. declaredStepsChanged is true where the hash of its declared
 *  step text differs from the recorded hash. */
type TVariance = { feature: string; seconds: number; was: number; steps: number; wasSteps: number; declaredStepsChanged: boolean };

/** Returns the features whose durations differ from the recorded timings by at least CHANGED_FRACTION of the recorded
 *  duration and at least CHANGED_SECONDS, largest difference first. It leaves out a feature that only one of the two
 *  runs holds. An added or removed feature changes what runs, not how long a run takes. */
export function variancesBetween(recorded: TTimings | undefined, now: TTimings): TVariance[] {
	if (!recorded) return [];
	const changed: TVariance[] = [];
	for (const [feature, { seconds, steps, declaredStepTextHash }] of Object.entries(now.features)) {
		const before = recorded.features[feature];
		if (!before) continue;
		const difference = Math.abs(seconds - before.seconds);
		if (difference < CHANGED_SECONDS || difference < before.seconds * CHANGED_FRACTION) continue;
		changed.push({ feature, seconds, was: before.seconds, steps, wasSteps: before.steps, declaredStepsChanged: declaredStepTextHash !== before.declaredStepTextHash });
	}
	return changed.sort((a, b) => Math.abs(b.seconds - b.was) - Math.abs(a.seconds - a.was));
}

/** Formats a variance as one line: the feature, both durations, the change as a percentage where the recorded duration
 *  isn't zero, the step count, the recorded step count where it differs, and a note where the declared steps changed. */
export function varianceLine(v: TVariance): string {
	const percent = v.was === 0 ? "" : ` (${v.seconds > v.was ? "+" : "-"}${Math.round((Math.abs(v.seconds - v.was) / v.was) * 100)}%)`;
	const steps = v.steps === v.wasSteps ? `${v.steps} steps` : `${v.steps} steps, was ${v.wasSteps}`;
	return `${v.feature} took ${v.seconds}s, was ${v.was}s${percent}, ${steps}${v.declaredStepsChanged ? ", its declared steps changed" : ""}`;
}

/** Every machine's timings, as the file holds them. */
const TimingsFileSchema = z.record(z.string(), z.unknown());

/** Reads every machine's timings from the file, or an empty record where the file doesn't exist. Throws where the file
 *  doesn't hold a JSON object, since replacing it would lose the timings of every machine it records. */
function recordedIn(file: string): TTimingsFile {
	if (!nodeFS.existsSync(file)) return {};
	const text = nodeFS.readFileSync(file, "utf-8");
	try {
		return TimingsFileSchema.parse(JSON.parse(text));
	} catch (e) {
		throw new Error(`${file} doesn't hold an object of timings by machine: ${e instanceof Error ? e.message : String(e)}. Restore it from git or remove it.`);
	}
}

/**
 * Writes a run's timings beside the group's configuration under this machine's class. Returns every feature whose
 * duration differs from the last run recorded for that class. The file's git history holds the series of runs. This
 * function compares against the newest entry, so a change that slows a feature shows in the first run after it.
 *
 * An unfiltered run holds every feature of the group, so its timings replace this machine's entry and drop a removed
 * feature. A run filtered to some features holds only those features. Each of those features replaces its own entry.
 * Every other feature keeps its recorded timing, and withTotals sums the totals again. Throws where this machine's entry
 * doesn't parse against TimingsSchema, since replacing it would lose its history.
 */
export function recordTimings(configDir: string, result: TExecutorResult, filtered: boolean): TVariance[] {
	const file = path.join(configDir, TIMINGS_FILE);
	const machine = machineKey();
	const now = timingsOf(result);
	const held = recordedIn(file);
	const entry = held[machine];
	const parsed = TimingsSchema.safeParse(entry);
	if (entry !== undefined && !parsed.success)
		throw new Error(`${file} holds an entry for ${machine} that isn't a set of timings: ${z.prettifyError(parsed.error)}. Restore it from git or remove the entry.`);
	const recorded = parsed.success ? parsed.data : undefined;
	const variances = variancesBetween(recorded, now);
	const written = filtered && recorded ? withTotals({ ...recorded.features, ...now.features }) : now;
	// Replaces only this machine's entry and keeps every other machine's entry. Machine keys are written in sorted
	// order, so the file changes only when a measurement changes.
	const merged: TTimingsFile = { ...held, [machine]: written };
	const ordered = Object.fromEntries(
		Object.keys(merged)
			.sort()
			.map((k) => [k, merged[k]]),
	);
	nodeFS.writeFileSync(file, `${JSON.stringify(ordered, null, "\t")}\n`);
	return variances;
}
