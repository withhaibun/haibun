/**
 * The actualities file: a group's last actuality, written beside the group's configuration and committed with the code. For
 * each class of machine and each way of running the group, it holds the state of the group's dependencies that the
 * actuality read, and the lines of the records of its execution and its features, each duration in tenths of a second. An
 * entry changes only where an outcome or a duration changes, so the file's git history holds the series of actualities and
 * their durations at each change.
 *
 * An actuality is evidence about the state it read. The CLI's --once option skips a group that passed against the present
 * state and runs a group that failed, so a person can retry a failure. InstanceStepper's startRun refuses a run in both
 * cases, because an agent's second run over unchanged features is a loop. An actuality of statements or a rehearsal doesn't
 * verify the group against a state, and doesn't read or write the file.
 */
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { TSpecl } from "@haibun/core/lib/execution.js";
import type { TRunPolicyConfig } from "@haibun/core/run-policy/domains/run-policy.js";
import { RECORDED_STATUS, type TExecutorResult } from "@haibun/core/lib/domains/protocol.js";
import { ACTUALITIES_FILE, dependencyRoots, dependencyState, repositoryTop } from "@haibun/core/lib/adapters/dependency-state.js";
import { SEQ_PATH_FIELD, StepLineSchema, stepLine } from "@haibun/core/lib/seq-path.js";
import type { TLevelRecords } from "@haibun/core/lib/actuality/pipelines/move-actuality.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";

/** How a group ran, as the file stores it: every feature passed, or one didn't. */
export type TOutcome = typeof RECORDED_STATUS.completed | typeof RECORDED_STATUS.failed;

/** A level's record as the file holds it: its line without the instants it began and ended, its duration in tenths of a
 *  second, so two actualities whose durations round to the same tenth write the same line. */
const LevelLineSchema = StepLineSchema.omit({ began: true, ended: true }).extend({ tookMs: z.number() });
/** A feature's line, with the number of steps it ran and the hash of the text of the steps it declares. The hash distinguishes a
 *  feature whose declared steps changed from one that ran the same steps slower. */
const FeatureLineSchema = LevelLineSchema.extend({ steps: z.number().int(), declaredStepTextHash: z.string() });
/** An actuality of a group: the state it read, which an actuality that didn't reach its features or whose outcome was
 *  cleared doesn't hold, its filter, and the lines of its execution and of each feature by its path. */
const ActualityEntrySchema = z.object({ state: z.string().optional(), filter: z.string(), execution: LevelLineSchema, features: z.record(z.string(), FeatureLineSchema) });
type TActualityEntry = z.infer<typeof ActualityEntrySchema>;
/** The actualities of a group by the class of the machine they ran on, then by their conditions. An actuality on other
 *  hardware takes other durations, and a comparison across machines reports a difference a change didn't cause. */
const ActualityFileSchema = z.record(z.string(), z.record(z.string(), ActualityEntrySchema));
type TActualityFile = z.infer<typeof ActualityFileSchema>;

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

/** The conditions of an actuality of a group: the configuration path and its contents, the feature bases, the working
 *  directory, the feature filter, the options, the module options, the policy and the steppers added beyond the
 *  configuration. verificationOf reads the dependency state through the configuration, the bases and the working
 *  directory. actualityConditions derives the key from every condition except the bases, the working directory and
 *  PER_ACTUALITY_OPTIONS, with the configuration path relative to the top of its repository. */
type TActualityConditions = {
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

/** Options that vary per actuality without changing what runs or what it reports. actualityConditions leaves them out of the key.
 *  KEY names an actuality, DESCRIPTION describes it, and STAY keeps the process up afterwards. */
const PER_ACTUALITY_OPTIONS = new Set(["KEY", "DESCRIPTION", "STAY"]);

/** Serializes a value with its object keys sorted, so equal conditions produce equal text in any key order. */
const stable = (value: unknown): string =>
	JSON.stringify(value, (_, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** Returns a key that distinguishes one way of running a group from another. The key doesn't include the bases or the
 *  working directory. They determine the dependency roots, and the content of the roots determines the state. The
 *  configuration's path is the one the caller states, so a caller states it relative to the repository's top and the
 *  key is the same in every checkout. */
export function actualityConditions(c: TActualityConditions): string {
	const options = Object.fromEntries(Object.entries(c.options).filter(([k]) => !PER_ACTUALITY_OPTIONS.has(k)));
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

/** An actuality's place in the actualities file: the file, the machine, the conditions, the filter comma-joined, the digest of the
 *  present content of every dependency, and the bases relative to the repository's top, comma-joined, which the
 *  execution's line states. */
type TVerification = { file: string; machine: string; conditions: string; filter: string; state: string; bases: string };

/** Returns the present state of a group's dependencies with an actuality's place in the actualities file. Returns undefined where the
 *  state can't be read. A caller then runs the group without consulting the file and doesn't record it. Every path the
 *  file records is relative to the top of the configuration's repository, so the file is the same in every checkout. */
export function verificationOf(c: TActualityConditions): TVerification | undefined {
	const configDir = path.dirname(path.resolve(c.configPath));
	const top = repositoryTop(configDir);
	const state = dependencyState(dependencyRoots(c.specl, c.bases, configDir, c.cwd), c.specl.environments ?? []);
	if (top === undefined || state === undefined) return undefined;
	const fromTop = (at: string) => path.join(".", path.relative(top, path.resolve(c.cwd, at)));
	const conditions = actualityConditions({ ...c, configPath: fromTop(c.configPath) });
	return { file: path.join(configDir, ACTUALITIES_FILE), machine: machineKey(), conditions, filter: c.filter.join(","), state, bases: c.bases.map(fromTop).join(", ") };
}

/** Reads the actualities file, or an empty record where the file doesn't exist. Throws where it doesn't parse, since
 *  replacing it would lose the actualities of every machine it records. */
function readActualities(file: string): TActualityFile {
	if (!nodeFS.existsSync(file)) return {};
	const parsed = ActualityFileSchema.safeParse(JSON.parse(nodeFS.readFileSync(file, "utf-8")));
	if (!parsed.success) throw new Error(`${file} doesn't hold actualities by machine and conditions: ${z.prettifyError(parsed.error)}. Restore it from git or remove it.`);
	return parsed.data;
}

/** Writes the actualities file with its machines and conditions in sorted order, so the file changes only when an entry
 *  changes. */
function writeActualities(file: string, actualities: TActualityFile): void {
	const sorted = <T>(record: Record<string, T>) =>
		Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, record[key] as T]),
		);
	nodeFS.writeFileSync(file, `${JSON.stringify(sorted(Object.fromEntries(Object.entries(actualities).map(([machine, entries]) => [machine, sorted(entries)]))), null, "\t")}\n`);
}

/** Returns the outcome of the group's last actuality under these conditions on this machine against its present state, or
 *  undefined where the file doesn't hold that actuality. */
export function outcomeAgainst(v: TVerification): TOutcome | undefined {
	const held = readActualities(v.file)[v.machine]?.[v.conditions];
	const status = held?.state === v.state ? held.execution.status : undefined;
	return status === RECORDED_STATUS.completed || status === RECORDED_STATUS.failed ? status : undefined;
}

/** Returns a level record's line as the file holds it. Throws for a level that didn't end, since an actuality's levels have
 *  all ended when it records itself. */
function levelLine(record: Record<string, unknown>) {
	const { began: _began, ended: _ended, tookMs, ...line } = stepLine(record);
	if (tookMs === undefined) throw new Error(`the level ${record[SEQ_PATH_FIELD.id]} didn't end, and an actuality records itself once its levels have ended`);
	return { ...line, tookMs: Math.round(tookMs / 100) * 100 };
}

/** Returns an actuality's entry: the state it read, and the lines of its execution's record and of each feature's record by
 *  its path, with the feature's step count and declared step text hash from its result. The execution's line states its
 *  bases relative to the repository's top in place of the bases its caller named. */
function entryOf(v: TVerification, result: TExecutorResult, levels: TLevelRecords): TActualityEntry {
	const records = [...levels.values()];
	const [execution, ...others] = records.filter((record) => record[SEQ_PATH_FIELD.actualityLevel] === "execution");
	if (execution === undefined || others.length > 0) throw new Error(`an actuality records one execution, and its levels hold ${others.length + (execution ? 1 : 0)}`);
	const features = records.flatMap((record) => {
		if (record[SEQ_PATH_FIELD.actualityLevel] !== "feature") return [];
		const ran = result.featureResults.find((feature) => feature.path === record[SEQ_PATH_FIELD.path]);
		if (ran === undefined) throw new Error(`the feature record ${record[SEQ_PATH_FIELD.id]} names ${record[SEQ_PATH_FIELD.path]}, which the results don't hold`);
		return [[ran.path, { ...levelLine(record), steps: ran.steps.count, declaredStepTextHash: ran.declaredStepTextHash }]];
	});
	return { state: v.state, filter: v.filter, execution: { ...levelLine(execution), text: v.bases }, features: Object.fromEntries(features) };
}

/** Writes an actuality under its conditions on this machine, and returns every feature whose duration differs from the
 *  entry it replaces. */
export function recordActuality(v: TVerification, result: TExecutorResult, levels: TLevelRecords): TVariance[] {
	const actualities = readActualities(v.file);
	const now = entryOf(v, result, levels);
	const variances = variancesBetween(actualities[v.machine]?.[v.conditions], now);
	writeActualities(v.file, { ...actualities, [v.machine]: { ...actualities[v.machine], [v.conditions]: now } });
	return variances;
}

/** Clears the state of each actuality that `held` selects, so it isn't evidence about a state, and keeps its durations. */
function forgetWhere(file: string, held: (machine: string, conditions: string, entry: TActualityEntry) => boolean): void {
	const actualities = readActualities(file);
	const forgotten = Object.fromEntries(
		Object.entries(actualities).map(([machine, entries]) => [
			machine,
			Object.fromEntries(Object.entries(entries).map(([conditions, entry]) => [conditions, held(machine, conditions, entry) ? { ...entry, state: undefined } : entry])),
		]),
	);
	if (Object.keys(actualities).length > 0) writeActualities(file, forgotten);
}

/** Clears the state of an actuality under these conditions on this machine. An actuality that didn't reach its features
 *  isn't evidence about the state. */
export const forgetOutcome = (v: TVerification): void => forgetWhere(v.file, (machine, conditions) => machine === v.machine && conditions === v.conditions);

/** Clears the state of actualities so a group's features run again in any state. Without a filter, it clears every
 *  actuality of the group. With a filter, it clears the actualities narrowed to that filter and the actualities of the whole
 *  group, because an actuality of the whole group includes those features. */
export function forgetOutcomes(configDir: string, filter?: string): void {
	forgetWhere(path.join(configDir, ACTUALITIES_FILE), (_machine, _conditions, entry) => !filter || entry.filter === filter || entry.filter === "");
}

/** The smallest change to report. A feature is reported where its duration differs from the recorded actuality by at least
 *  a fifth of the recorded duration and by at least a second. Three actualities of one group recorded 6.2, 6.3 and 6.3 seconds
 *  for its largest feature, so a fifth exceeds the spread between actualities of unchanged code. The one-second minimum keeps
 *  a short feature's small changes out of the report. */
const CHANGED_FRACTION = 0.2;
const CHANGED_MS = 1000;

/** A feature whose duration differs from the recorded actuality, in seconds. declaredStepsChanged is true where the hash of its
 *  declared step text differs from the recorded hash. */
type TVariance = { feature: string; seconds: number; was: number; steps: number; wasSteps: number; declaredStepsChanged: boolean };

/** Returns the features whose durations differ from the recorded actuality by at least CHANGED_FRACTION of the recorded duration
 *  and at least CHANGED_MS, largest difference first. It leaves out a feature that only one of the two actualities holds. An
 *  added or removed feature changes what runs, not how long an actuality takes. */
export function variancesBetween(recorded: TActualityEntry | undefined, now: TActualityEntry): TVariance[] {
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
