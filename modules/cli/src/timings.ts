/**
 * How long a run of features took, written beside the group's configuration after every whole run and meant to be
 * committed with the code: the history of the file is the history of what each feature costs, so a change that makes
 * a feature slower or faster is seen in the same commit that made it.
 *
 * Seconds per feature, rounded to a tenth so a run that took the same time writes the same file; the step count and
 * the whole, so a feature gaining steps is told apart from a feature whose steps got slower.
 */
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TExecutorResult } from "@haibun/core/schema/protocol.js";
import { TIMINGS_FILE } from "@haibun/core/lib/util/node/dependency-state.js";

export { TIMINGS_FILE };

export type TTimings = { features: Record<string, { seconds: number; steps: number }>; steps: number; seconds: number };

/** The file holds one set of timings per machine class: a run on other hardware takes other times, and comparing
 *  across machines reports a difference that no change caused. */
export type TTimingsFile = Record<string, TTimings>;

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

/** What a run took, feature by feature, from the steps' own start and end. */
export function timingsOf(result: TExecutorResult): TTimings {
	const features: TTimings["features"] = {};
	let steps = 0;
	let ms = 0;
	for (const feature of result.featureResults ?? []) {
		const starts = feature.stepResults.map((s) => s.start).filter((s): s is number => typeof s === "number");
		const ends = feature.stepResults.map((s) => s.end).filter((s): s is number => typeof s === "number");
		const took = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;
		features[feature.path] = { seconds: tenth(took), steps: feature.stepResults.length };
		steps += feature.stepResults.length;
		ms += took;
	}
	return { features, steps, seconds: tenth(ms) };
}

/** The smallest change worth reporting: a feature that ran at least this much longer or shorter than the recorded run,
 *  by both measures. Three runs of one group recorded 6.2, 6.3 and 6.3 seconds for its largest feature, so a fifth is
 *  well clear of the spread between identical runs, and a second holds a short feature below the reporting line. */
const CHANGED_FRACTION = 0.2;
const CHANGED_SECONDS = 1;

/** One feature whose duration or step count differs from the recorded run. */
export type TVariance = { feature: string; seconds: number; was: number; steps: number; wasSteps: number };

/** The features whose durations differ from what was recorded, largest difference first. A feature absent from either
 *  run is left out: an added or removed feature is a change in what runs rather than in what a run costs. */
export function variancesBetween(recorded: TTimings | undefined, now: TTimings): TVariance[] {
	if (!recorded) return [];
	const changed: TVariance[] = [];
	for (const [feature, { seconds, steps }] of Object.entries(now.features)) {
		const before = recorded.features[feature];
		if (!before) continue;
		const difference = Math.abs(seconds - before.seconds);
		if (difference < CHANGED_SECONDS || difference < before.seconds * CHANGED_FRACTION) continue;
		changed.push({ feature, seconds, was: before.seconds, steps, wasSteps: before.steps });
	}
	return changed.sort((a, b) => Math.abs(b.seconds - b.was) - Math.abs(a.seconds - a.was));
}

/** How a variance reads: the feature, both durations, the change as a percentage, and the step counts where they differ. */
export function varianceLine(v: TVariance): string {
	const percent = v.was === 0 ? "" : ` (${v.seconds > v.was ? "+" : "-"}${Math.round((Math.abs(v.seconds - v.was) / v.was) * 100)}%)`;
	const steps = v.steps === v.wasSteps ? `${v.steps} steps` : `${v.steps} steps, was ${v.wasSteps}`;
	return `${v.feature} took ${v.seconds}s, was ${v.was}s${percent}, ${steps}`;
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
 */
export function recordTimings(configDir: string, result: TExecutorResult): TVariance[] {
	const file = path.join(configDir, TIMINGS_FILE);
	const machine = machineKey();
	const now = timingsOf(result);
	const held = recordedIn(file);
	const recorded = held[machine];
	const variances = variancesBetween(recorded && recorded.features ? recorded : undefined, now);
	// Only this machine's entry is replaced: what another machine measured stays as that machine measured it. The
	// machines are written in a stable order, so a file changes when a measurement changes and at no other time.
	const merged: TTimingsFile = { ...held, [machine]: now };
	const ordered = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
	nodeFS.writeFileSync(file, `${JSON.stringify(ordered, null, "\t")}\n`);
	return variances;
}
