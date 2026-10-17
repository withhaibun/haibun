/**
 * The runs file: how a group last ran, written beside the group's configuration and committed with the code. For each class
 * of machine and each way of running the group, it holds the state of the group's dependencies that a run read, and the
 * lines of the records of its execution and features, each duration in tenths of a second. An entry changes only
 * where an outcome or a duration changes, so the file's git history holds the series of runs and their durations at each change.
 *
 * A run is evidence about the state it read. The CLI's --once option skips a group that passed against the present state
 * and runs a group that failed, so a person can retry a failure. InstanceStepper's startRun refuses a run in both cases,
 * because an agent's second run over unchanged features is a loop. A run of statements or a rehearsal doesn't verify the
 * group against a state, and doesn't read or write the file.
 */
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { TSpecl } from "@haibun/core/lib/execution.js";
import type { TRunPolicyConfig } from "@haibun/core/run-policy/run-policy-types.js";
import { RECORDED_STATUS, type TExecutorResult } from "@haibun/core/schema/protocol.js";
import { RUNS_FILE, dependencyRoots, dependencyState, repositoryTop } from "@haibun/core/lib/util/node/dependency-state.js";
import { SEQ_PATH_FIELD, StepLineSchema, stepLine } from "@haibun/core/lib/seq-path.js";
import type { TLevelRecords } from "@haibun/core/lib/actuality/pipelines/move-actuality.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";

/** How a group ran, as the file stores it: every feature passed, or one didn't. */
export type TOutcome = typeof RECORDED_STATUS.completed | typeof RECORDED_STATUS.failed;

/** A level's record as the file holds it: its line without the instants it began and ended, its duration in tenths of a
 *  second, so two runs whose durations round to the same tenth write the same line. */
const LevelLineSchema = StepLineSchema.omit({ began: true, ended: true }).extend({ tookMs: z.number() });
/** A feature's line, with the number of steps it ran and the hash of the text of the steps it declares. The hash distinguishes a
 *  feature whose declared steps changed from one that ran the same steps slower. */
const FeatureLineSchema = LevelLineSchema.extend({ steps: z.number().int(), declaredStepTextHash: z.string() });
/** A run of a group: the state it read, which a run that didn't reach its features or whose outcome was cleared doesn't
 *  hold, its filter, and the lines of its execution and of each feature by its path. */
const RunEntrySchema = z.object({ state: z.string().optional(), filter: z.string(), execution: LevelLineSchema, features: z.record(z.string(), FeatureLineSchema) });
type TRunEntry = z.infer<typeof RunEntrySchema>;
/** The runs of a group by the class of the machine they ran on, then by their conditions. A run on other hardware takes other
 *  durations, and a comparison across machines reports a difference a change didn't cause. */
const RunFileSchema = z.record(z.string(), z.record(z.string(), RunEntrySchema));
type TRunFile = z.infer<typeof RunFileSchema>;

/** Returns a key for the class of this machine: its platform, its architecture, its core count and its processor model.
 *  The key describes the hardware and doesn't name the host or the user. */
export function machineKey(): string {
	const cpus = os.cpus();
	const model = itemAt(cpus, 0)
		.model.toLowerCase()
		.replace(/\((r|tm)\)/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `${os.platform()}-${os.arch()}-${cpus.length}x-${model}`;
}

/** The conditions of a run of a group: the configuration path and its contents, the feature bases, the working
 *  directory, the feature filter, the options, the module options, the policy and the steppers added beyond the
 *  configuration. verificationOf reads the dependency state through the configuration, the bases and the working
 *  directory. runConditions derives the key from every condition except the bases, the working directory and
 *  PER_RUN_OPTIONS, with the configuration path relative to the top of its repository. */
type TRunConditions = {
	configPath: string;
	specl: TSpecl;
	bases: readonly string[];
	cwd: string;
	filter: readonly string[];
	options: Record<string, unknown>;
	moduleOptions: Record<string, unknown>;
	policy?: TRunPolicyConfig;
	withSteppers?: readonly string[];
};

/** Options that vary per run without changing what runs or what it reports. runConditions leaves them out of the key.
 *  KEY names a run, DESCRIPTION describes it, and STAY keeps the process up afterwards. */
const PER_RUN_OPTIONS = new Set(["KEY", "DESCRIPTION", "STAY"]);

/** Serializes a value with its object keys sorted, so equal conditions produce equal text in any key order. */
const stable = (value: unknown): string =>
	JSON.stringify(value, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** Returns a key that distinguishes one way of running a group from another. The key doesn't include the bases or the
 *  working directory. They determine the dependency roots, and the content of the roots determines the state. The
 *  configuration's path is the one the caller states, so a caller states it relative to the repository's top and the
 *  key is the same in every checkout. */
export function runConditions(c: TRunConditions): string {
	const options = Object.fromEntries(Object.entries(c.options).filter(([k]) => !PER_RUN_OPTIONS.has(k)));
	const keyed = {
		configPath: c.configPath,
		specl: c.specl,
		filter: [...c.filter],
		options,
		moduleOptions: c.moduleOptions,
		policy: c.policy ?? null,
		withSteppers: [...(c.withSteppers ?? [])],
	};
	return createHash("sha256").update(stable(keyed)).digest("hex").slice(0, 16);
}

/** A run's place in the runs file: the file, the machine, the conditions, the filter comma-joined, the digest of the
 *  present content of every dependency, and the bases relative to the repository's top, comma-joined, which the
 *  execution's line states. */
type TVerification = { file: string; machine: string; conditions: string; filter: string; state: string; bases: string };

/** Returns the present state of a group's dependencies with a run's place in the runs file. Returns undefined where the
 *  state can't be read. A caller then runs the group without consulting the file and doesn't record it. Every path the
 *  file records is relative to the top of the configuration's repository, so the file is the same in every checkout. */
export function verificationOf(c: TRunConditions): TVerification | undefined {
	const configDir = path.dirname(path.resolve(c.configPath));
	const top = repositoryTop(configDir);
	const state = dependencyState(dependencyRoots(c.specl, c.bases, configDir, c.cwd), c.specl.environments ?? []);
	if (top === undefined || state === undefined) return undefined;
	const fromTop = (at: string) => path.join(".", path.relative(top, path.resolve(c.cwd, at)));
	const conditions = runConditions({ ...c, configPath: fromTop(c.configPath) });
	return { file: path.join(configDir, RUNS_FILE), machine: machineKey(), conditions, filter: c.filter.join(","), state, bases: c.bases.map(fromTop).join(", ") };
}

/** Reads the runs file, or an empty record where the file doesn't exist. Throws where it doesn't parse, since replacing it
 *  would lose the runs of every machine it records. */
function readRuns(file: string): TRunFile {
	if (!nodeFS.existsSync(file)) return {};
	const parsed = RunFileSchema.safeParse(JSON.parse(nodeFS.readFileSync(file, "utf-8")));
	if (!parsed.success) throw new Error(`${file} doesn't hold runs by machine and conditions: ${z.prettifyError(parsed.error)}. Restore it from git or remove it.`);
	return parsed.data;
}

/** Writes the runs file with its machines and conditions in sorted order, so the file changes only when an entry changes. */
function writeRuns(file: string, runs: TRunFile): void {
	const sorted = <T>(record: Record<string, T>) =>
		Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, record[key] as T]),
		);
	nodeFS.writeFileSync(file, `${JSON.stringify(sorted(Object.fromEntries(Object.entries(runs).map(([machine, entries]) => [machine, sorted(entries)]))), null, "\t")}\n`);
}

/** Returns the outcome of the group's last run under these conditions on this machine against its present state, or
 *  undefined where the file doesn't hold that run. */
export function outcomeAgainst(v: TVerification): TOutcome | undefined {
	const held = readRuns(v.file)[v.machine]?.[v.conditions];
	const status = held?.state === v.state ? held.execution.status : undefined;
	return status === RECORDED_STATUS.completed || status === RECORDED_STATUS.failed ? status : undefined;
}

/** Returns a level record's line as the file holds it. Throws for a level that didn't end, since a run's levels have all
 *  ended when it records itself. */
function levelLine(record: Record<string, unknown>) {
	const { began: _began, ended: _ended, tookMs, ...line } = stepLine(record);
	if (tookMs === undefined) throw new Error(`the level ${record[SEQ_PATH_FIELD.id]} didn't end, and a run records itself once its levels have ended`);
	return { ...line, tookMs: Math.round(tookMs / 100) * 100 };
}

/** Returns a run's entry: the state it read, and the lines of its execution's record and of each feature's record by
 *  its path, with the feature's step count and declared step text hash from its result. The execution's line states its
 *  bases relative to the repository's top in place of the bases its caller named. */
function entryOf(v: TVerification, result: TExecutorResult, levels: TLevelRecords): TRunEntry {
	const records = [...levels.values()];
	const [execution, ...others] = records.filter((record) => record[SEQ_PATH_FIELD.actualityLevel] === "execution");
	if (execution === undefined || others.length > 0) throw new Error(`a run records one execution, and its levels hold ${others.length + (execution ? 1 : 0)}`);
	const features = records.flatMap((record) => {
		if (record[SEQ_PATH_FIELD.actualityLevel] !== "feature") return [];
		const ran = result.featureResults.find((feature) => feature.path === record[SEQ_PATH_FIELD.path]);
		if (ran === undefined) throw new Error(`the feature record ${record[SEQ_PATH_FIELD.id]} names ${record[SEQ_PATH_FIELD.path]}, which the results don't hold`);
		return [[ran.path, { ...levelLine(record), steps: ran.steps.count, declaredStepTextHash: ran.declaredStepTextHash }]];
	});
	return { state: v.state, filter: v.filter, execution: { ...levelLine(execution), text: v.bases }, features: Object.fromEntries(features) };
}

/** Writes a run under its conditions on this machine, and returns every feature whose duration differs from the entry it
 *  replaces. */
export function recordRun(v: TVerification, result: TExecutorResult, levels: TLevelRecords): TVariance[] {
	const runs = readRuns(v.file);
	const now = entryOf(v, result, levels);
	const variances = variancesBetween(runs[v.machine]?.[v.conditions], now);
	writeRuns(v.file, { ...runs, [v.machine]: { ...runs[v.machine], [v.conditions]: now } });
	return variances;
}

/** Clears the state of each run that `held` selects, so it isn't evidence about a state, and keeps its durations. */
function forgetWhere(file: string, held: (machine: string, conditions: string, entry: TRunEntry) => boolean): void {
	const runs = readRuns(file);
	const forgotten = Object.fromEntries(
		Object.entries(runs).map(([machine, entries]) => [
			machine,
			Object.fromEntries(Object.entries(entries).map(([conditions, entry]) => [conditions, held(machine, conditions, entry) ? { ...entry, state: undefined } : entry])),
		]),
	);
	if (Object.keys(runs).length > 0) writeRuns(file, forgotten);
}

/** Clears the state of a run under these conditions on this machine. A run that didn't reach its features isn't evidence
 *  about the state. */
export const forgetOutcome = (v: TVerification): void => forgetWhere(v.file, (machine, conditions) => machine === v.machine && conditions === v.conditions);

/** Clears the state of runs so a group's features run again in any state. Without a filter, it clears every run of the
 *  group. With a filter, it clears the runs narrowed to that filter and the runs of the whole group, because a run of the
 *  whole group includes those features. */
export function forgetOutcomes(configDir: string, filter?: string): void {
	forgetWhere(path.join(configDir, RUNS_FILE), (_machine, _conditions, entry) => !filter || entry.filter === filter || entry.filter === "");
}

/** The smallest change to report. A feature is reported where its duration differs from the recorded run by at least
 *  a fifth of the recorded duration and by at least a second. Three runs of one group recorded 6.2, 6.3 and 6.3 seconds
 *  for its largest feature, so a fifth exceeds the spread between runs of unchanged code. The one-second minimum keeps
 *  a short feature's small changes out of the report. */
const CHANGED_FRACTION = 0.2;
const CHANGED_MS = 1000;

/** A feature whose duration differs from the recorded run, in seconds. declaredStepsChanged is true where the hash of its
 *  declared step text differs from the recorded hash. */
type TVariance = { feature: string; seconds: number; was: number; steps: number; wasSteps: number; declaredStepsChanged: boolean };

/** Returns the features whose durations differ from the recorded run by at least CHANGED_FRACTION of the recorded duration
 *  and at least CHANGED_MS, largest difference first. It leaves out a feature that only one of the two runs holds. An added
 *  or removed feature changes what runs, not how long a run takes. */
export function variancesBetween(recorded: TRunEntry | undefined, now: TRunEntry): TVariance[] {
	const changed: TVariance[] = [];
	for (const [feature, { tookMs, steps, declaredStepTextHash }] of Object.entries(now.features)) {
		const before = recorded?.features[feature];
		if (!before) continue;
		const difference = Math.abs(tookMs - before.tookMs);
		if (difference < CHANGED_MS || difference < before.tookMs * CHANGED_FRACTION) continue;
		changed.push({
			feature,
			seconds: tookMs / 1000,
			was: before.tookMs / 1000,
			steps,
			wasSteps: before.steps,
			declaredStepsChanged: declaredStepTextHash !== before.declaredStepTextHash,
		});
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
