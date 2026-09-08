/**
 * How long a run of features took, written beside the group's configuration after every whole run and meant to be
 * committed with the code: the history of the file is the history of what each feature costs, so a change that makes
 * a feature slower or faster is seen in the same commit that made it.
 *
 * Seconds per feature, rounded to a tenth so a run that took the same time writes the same file; the step count and
 * the whole, so a feature gaining steps is told apart from a feature whose steps got slower.
 */
import nodeFS from "node:fs";
import path from "node:path";
import type { TExecutorResult } from "@haibun/core/schema/protocol.js";
import { TIMINGS_FILE } from "@haibun/core/lib/util/node/dependency-state.js";

export { TIMINGS_FILE };

export type TTimings = { features: Record<string, { seconds: number; steps: number }>; steps: number; seconds: number };

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

/** Write what the run took beside its configuration, replacing what the last run wrote: the history is git's. */
export function recordTimings(configDir: string, result: TExecutorResult): void {
	nodeFS.writeFileSync(path.join(configDir, TIMINGS_FILE), `${JSON.stringify(timingsOf(result), null, "\t")}\n`);
}
