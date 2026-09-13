/**
 * How long a run of features took, written beside the group's configuration after every run and meant to be committed
 * with the code: the history of the file is the history of what each feature takes, so a change that makes a feature
 * slower or faster is seen in the same commit that made it.
 *
 * Seconds per feature, rounded to a tenth so a run that took the same time writes the same file; the steps it ran and
 * the hash of the text of the steps it declares, so a feature whose declared steps changed is told apart from a feature
 * that ran the same steps slower.
 */
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { TExecutorResult } from "@haibun/core/schema/protocol.js";
import { TIMINGS_FILE } from "@haibun/core/lib/util/node/dependency-state.js";

export { TIMINGS_FILE };

/** What one feature took: the seconds from its first step's start to its last step's end, how many steps it ran, and
 *  the SHA-256 of the text of the steps it declares. */
const FeatureTimingSchema = z.object({ seconds: z.number(), steps: z.number().int(), declaredStepTextHash: z.string() });
const TimingsSchema = z.object({ features: z.record(z.string(), FeatureTimingSchema), steps: z.number().int(), seconds: z.number() });
export type TFeatureTiming = z.infer<typeof FeatureTimingSchema>;
export type TTimings = z.infer<typeof TimingsSchema>;

/** The file holds one set of timings per machine class: a run on other hardware takes other times, and comparing
 *  across machines reports a difference that no change caused. */
export type TTimingsFile = Record<string, unknown>;

/** The class of machine a run was measured on: its processor model, how many cores it has, its architecture and its
 *  platform. It describes the hardware and names neither the host nor the user. */
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

/** Timings for a set of features, with the whole: every step they ran and the seconds they took, summed in tenths. */
function withTotals(features: Record<string, TFeatureTiming>): TTimings {
	const all = Object.values(features);
	return { features, steps: all.reduce((sum, f) => sum + f.steps, 0), seconds: Math.round(all.reduce((sum, f) => sum + f.seconds * 10, 0)) / 10 };
}

/** What a run took, feature by feature, from what every step of each feature came to: a long feature holds only its
 *  most recent step results, and its count, first start and last end still cover every step. */
export function timingsOf(result: TExecutorResult): TTimings {
	const features: Record<string, TFeatureTiming> = {};
	for (const feature of result.featureResults ?? []) {
		const { count, firstStart, lastEnd } = feature.steps;
		const took = firstStart !== undefined && lastEnd !== undefined ? lastEnd - firstStart : 0;
		features[feature.path] = { seconds: tenth(took), steps: count, declaredStepTextHash: feature.declaredStepTextHash };
	}
	return withTotals(features);
}

/** The smallest change to report: a feature that ran at least this much longer or shorter than the recorded run,
 *  by both measures. Three runs of one group recorded 6.2, 6.3 and 6.3 seconds for its largest feature, so a fifth is
 *  well clear of the spread between identical runs, and a second holds a short feature below the reporting line. */
const CHANGED_FRACTION = 0.2;
const CHANGED_SECONDS = 1;

/** One feature whose duration differs from the recorded run, with whether its declared steps changed since. */
export type TVariance = { feature: string; seconds: number; was: number; steps: number; wasSteps: number; declaredStepsChanged: boolean };

/** The features whose durations differ from what was recorded, largest difference first. A feature absent from either
 *  run is left out: an added or removed feature is a change in what runs rather than in what a run takes. */
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

/** How a variance reads: the feature, both durations, the change as a percentage, the step counts where they differ, and
 *  whether the feature's declared steps changed. */
export function varianceLine(v: TVariance): string {
	const percent = v.was === 0 ? "" : ` (${v.seconds > v.was ? "+" : "-"}${Math.round((Math.abs(v.seconds - v.was) / v.was) * 100)}%)`;
	const steps = v.steps === v.wasSteps ? `${v.steps} steps` : `${v.steps} steps, was ${v.wasSteps}`;
	return `${v.feature} took ${v.seconds}s, was ${v.was}s${percent}, ${steps}${v.declaredStepsChanged ? ", its declared steps changed" : ""}`;
}

/** Every machine's timings in the file, or an empty record where the file is absent or holds something else. */
function recordedIn(file: string): TTimingsFile {
	if (!nodeFS.existsSync(file)) return {};
	try {
		const held = JSON.parse(nodeFS.readFileSync(file, "utf-8")) as TTimingsFile;
		return held && typeof held === "object" && !Array.isArray(held) ? held : {};
	} catch {
		return {};
	}
}

/**
 * Write what the run took beside its configuration, under the class of machine that measured it, and report every
 * feature whose duration differs from the last run on that same class. The file's history in git is the series; this
 * reports the newest entry in it, so a change that makes a feature slower is named by the run that made it.
 *
 * A whole run states every feature the group holds, so it replaces what this machine recorded, and a removed feature
 * goes with it. A run filtered to some features states only those, so each replaces its own entry and every other
 * feature stays as recorded. An entry recorded in another form is replaced rather than compared.
 */
export function recordTimings(configDir: string, result: TExecutorResult, filtered: boolean): TVariance[] {
	const file = path.join(configDir, TIMINGS_FILE);
	const machine = machineKey();
	const now = timingsOf(result);
	const held = recordedIn(file);
	const parsed = TimingsSchema.safeParse(held[machine]);
	const recorded = parsed.success ? parsed.data : undefined;
	const variances = variancesBetween(recorded, now);
	const written = filtered && recorded ? withTotals({ ...recorded.features, ...now.features }) : now;
	// Only this machine's entry is replaced: what another machine measured stays as that machine measured it. The
	// machines are written in a stable order, so a file changes when a measurement changes and at no other time.
	const merged: TTimingsFile = { ...held, [machine]: written };
	const ordered = Object.fromEntries(
		Object.keys(merged)
			.sort()
			.map((k) => [k, merged[k]]),
	);
	nodeFS.writeFileSync(file, `${JSON.stringify(ordered, null, "\t")}\n`);
	return variances;
}
