/**
 * The actualities file: a group's last actuality, written beside the group's configuration and committed with the code. For
 * each class of machine and each way of running the group, it holds the lines of the records of the actuality and its
 * features, each duration in tenths of a second, and the actuality's own line holds the digest of each dependency it read. An
 * entry changes only where an outcome or a duration changes, so the file's git history holds the series of actualities and
 * their durations at each change.
 *
 * An actuality is evidence about the state it read. The CLI's --once option skips a group whose last actuality passed where
 * every dependency holds the digest it held then, and runs a group that failed, so a person can retry a failure. It doesn't skip a
 * run that stays after its features end, such as a launched instance or a service, since that run serves what they start.
 * InstanceStepper's startRun refuses a run in both cases, because an agent's second run over unchanged features is a loop.
 * An actuality of statements or a rehearsal doesn't verify the group against a state, and doesn't read or write the file.
 */
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { TSpecl } from "@haibun/core/lib/actuality.js";
import type { TRunPolicyConfig } from "@haibun/core/run-policy/domains/run-policy.js";
import { RECORDED_STATUS, type TExecutorResult } from "@haibun/core/lib/domains/protocol.js";
import { ACTUALITIES_FILE, dependencyRoots, dependencyState, repositoryTop } from "@haibun/core/lib/adapters/dependency-state.js";
import { SEQ_PATH_FIELD, StepLineSchema, stepLine } from "@haibun/core/lib/seq-path.js";
import type { TLevelRecords } from "@haibun/core/lib/actuality/pipelines/move-actuality.js";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import { DigestSchema, DigestTextSchema, sha256, type TDigest } from "@haibun/core/lib/domains/digest.js";

/** How a group ran, as the file stores it: every feature passed, or one didn't. */
export type TGroupEnded = typeof RECORDED_STATUS.completed | typeof RECORDED_STATUS.failed;

/** A level's record as the file holds it: its line without the instants it began and ended, its duration in tenths of a
 *  second, so two actualities whose durations round to the same tenth write the same line, and its record's digests. The
 *  line of an actuality that didn't reach its features or whose outcome was cleared doesn't hold its digests. */
const LevelLineSchema = StepLineSchema.omit({ began: true, ended: true }).extend({ tookMs: z.number(), digest: DigestSchema.optional() });
/** A feature's line, with the number of steps it ran. */
const FeatureLineSchema = LevelLineSchema.extend({ steps: z.number().int() });
/** An actuality of a group: its filter, and the lines of its own record and of each feature by its path. */
const ActualityEntrySchema = z.object({ filter: z.string(), actuality: LevelLineSchema, features: z.record(z.string(), FeatureLineSchema) });
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
 *  KEY names an actuality, STAY keeps the process up afterwards, and ONCE has the CLI read the file first, so the record of a run
 *  without it skips a run with it, as it does a run given --once. */
const PER_ACTUALITY_OPTIONS = new Set(["KEY", "STAY", "ONCE"]);

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
	return sha256(stable(keyed)).slice(0, 16);
}

/** An actuality's place in the actualities file: the file, the machine, the conditions, the filter comma-joined, the digest of the
 *  present content of each dependency, and the bases relative to the repository's top, comma-joined, which the
 *  actuality's line states. */
type TVerification = { file: string; machine: string; conditions: string; filter: string; digest: TDigest; bases: string };

/** Returns the present state of a group's dependencies with an actuality's place in the actualities file. Returns undefined where the
 *  state can't be read. A caller then runs the group without consulting the file and doesn't record it. Every path the
 *  file records is relative to the top of the configuration's repository, so the file is the same in every checkout. */
export async function verificationOf(c: TActualityConditions): Promise<TVerification | undefined> {
	const configDir = path.dirname(path.resolve(c.configPath));
	const top = await repositoryTop(configDir);
	const digest = await dependencyState(dependencyRoots(c.specl, c.bases, configDir, c.cwd));
	if (top === undefined || digest === undefined) return undefined;
	const fromTop = (at: string) => path.join(".", path.relative(top, path.resolve(c.cwd, at)));
	const conditions = actualityConditions({ ...c, configPath: fromTop(c.configPath) });
	return { file: path.join(configDir, ACTUALITIES_FILE), machine: machineKey(), conditions, filter: c.filter.join(","), digest, bases: c.bases.map(fromTop).join(", ") };
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
 *  changes. It writes the file beside itself and renames it over the file, so a run that reads it while another run of the
 *  group writes it reads the whole file, as it was before or after, and a write that stops partway leaves it as it was. */
function writeActualities(file: string, actualities: TActualityFile): void {
	const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	// The file is parsed as it is written, as it is when it is read, so it holds only what its schema states.
	const written = ActualityFileSchema.parse(actualities);
	const beside = `${file}.${process.pid}`;
	nodeFS.writeFileSync(beside, `${JSON.stringify(sorted(Object.fromEntries(Object.entries(written).map(([machine, entries]) => [machine, sorted(entries)]))), null, "\t")}\n`);
	nodeFS.renameSync(beside, file);
}

/** Returns each dependency whose digest differs between two states, or that one of them doesn't hold, in sorted order. */
const changedDependencies = (held: TDigest, now: TDigest): string[] => [...new Set([...Object.keys(held), ...Object.keys(now)])].filter((at) => held[at] !== now[at]).sort();

/** Returns the outcome of the group's last actuality under these conditions on this machine, where every dependency holds the
 *  digest it held then, or undefined where the file doesn't hold that actuality. */
export function outcomeAgainst(v: TVerification): TGroupEnded | undefined {
	const held = readActualities(v.file)[v.machine]?.[v.conditions]?.actuality;
	const status = held?.digest !== undefined && changedDependencies(held.digest, v.digest).length === 0 ? held.status : undefined;
	return status === RECORDED_STATUS.completed || status === RECORDED_STATUS.failed ? status : undefined;
}

/** Returns a level record's line as the file holds it. Throws for a level that didn't end, since an actuality's levels have
 *  all ended when it records itself. */
function levelLine(record: Record<string, unknown>) {
	const { began: _began, ended: _ended, tookMs, ...line } = stepLine(record);
	if (tookMs === undefined) throw new Error(`the level ${record[SEQ_PATH_FIELD.id]} didn't end, and an actuality records itself once its levels have ended`);
	return { ...line, tookMs: Math.round(tookMs / 100) * 100, digest: DigestTextSchema.optional().parse(record[SEQ_PATH_FIELD.digest]) };
}

/** Returns an actuality's entry: the lines of its own record and of each feature's record by its path, with the feature's
 *  step count from its result. Its own line states its bases relative to the repository's top in place of the bases its
 *  caller named. */
function entryOf(v: TVerification, result: TExecutorResult, levels: TLevelRecords): TActualityEntry {
	const records = [...levels.values()];
	const [own, ...others] = records.filter((record) => record[SEQ_PATH_FIELD.actualityLevel] === "actuality");
	if (own === undefined || others.length > 0) throw new Error(`an actuality records one record of its own, and its levels hold ${others.length + (own ? 1 : 0)}`);
	const features = records.flatMap((record) => {
		if (record[SEQ_PATH_FIELD.actualityLevel] !== "feature") return [];
		const ran = result.featureResults.find((feature) => feature.path === record[SEQ_PATH_FIELD.path]);
		if (ran === undefined) throw new Error(`the feature record ${record[SEQ_PATH_FIELD.id]} names ${record[SEQ_PATH_FIELD.path]}, which the results don't hold`);
		return [[ran.path, { ...levelLine(record), steps: ran.steps.count }]];
	});
	return { filter: v.filter, actuality: { ...levelLine(own), text: v.bases }, features: Object.fromEntries(features) };
}

/** Writes an actuality under its conditions on this machine, in place of the entry it held. */
export function recordActuality(v: TVerification, result: TExecutorResult, levels: TLevelRecords): void {
	const actualities = readActualities(v.file);
	writeActualities(v.file, { ...actualities, [v.machine]: { ...actualities[v.machine], [v.conditions]: entryOf(v, result, levels) } });
}

/** Clears the digests of each actuality that `held` selects, so it isn't evidence about a state, and keeps its durations. */
function forgetWhere(file: string, held: (machine: string, conditions: string, entry: TActualityEntry) => boolean): void {
	const actualities = readActualities(file);
	for (const [machine, entries] of Object.entries(actualities))
		for (const [conditions, entry] of Object.entries(entries)) if (held(machine, conditions, entry)) delete entry.actuality.digest;
	if (Object.keys(actualities).length > 0) writeActualities(file, actualities);
}

/** Clears the digests of an actuality under these conditions on this machine. An actuality that didn't reach its features
 *  isn't evidence about the state. */
export const forgetOutcome = (v: TVerification): void => forgetWhere(v.file, (machine, conditions) => machine === v.machine && conditions === v.conditions);

/** Clears the digests of actualities so a group's features run again in any state. Without a filter, it clears every
 *  actuality of the group. With a filter, it clears the actualities narrowed to that filter and the actualities of the whole
 *  group, because an actuality of the whole group includes those features. */
export function forgetOutcomes(configDir: string, filter?: string): void {
	forgetWhere(path.join(configDir, ACTUALITIES_FILE), (_machine, _conditions, entry) => !filter || entry.filter === filter || entry.filter === "");
}
