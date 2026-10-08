/**
 * Records how a group of features last ran against the state of its dependencies. A caller reads the record to
 * determine whether the group runs again.
 *
 * A run is evidence about that state. A group whose dependencies changed doesn't have a run against its present state,
 * so the group runs. Each reader of the record determines what follows from a run against the present state. The
 * CLI's --once option skips a group that passed and runs a group that failed, so a person can retry a failure.
 * InstanceStepper's startRun step refuses a run in both cases, because an agent's second run over unchanged features is
 * a loop.
 *
 * The record is written beside the group's configuration. It describes the working tree where it was written, so it
 * isn't committed.
 *
 * A run of statements or a rehearsal doesn't verify the group against a state, and doesn't read or write the record.
 * The record keys each run by its conditions. The conditions include the feature filter, the policy and the steppers
 * added beyond the configuration.
 */
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import path from "node:path";
import type { TSpecl } from "@haibun/core/lib/execution.js";
import type { TRunPolicyConfig } from "@haibun/core/run-policy/run-policy-types.js";
import { VERIFIED_FILE, dependencyRoots, dependencyState } from "@haibun/core/lib/util/node/dependency-state.js";

/** How a group ran: every feature passed, or one did not. */
export type TOutcome = "passed" | "failed";

/** Recorded runs keyed by their conditions. Each entry holds a run's state, outcome, feature count and filter. The
 *  record doesn't store a value that varies between two runs against one state, so the file changes only when an entry
 *  changes. */
type TVerifiedRecord = Record<string, { state: string; outcome: TOutcome; features: number; filter: string }>;

/** The conditions of a run of a group: the configuration path and its contents, the feature bases, the working
 *  directory, the feature filter, the options, the module options, the policy and the steppers added beyond the
 *  configuration. verificationOf reads the dependency state through the configuration, the bases and the working
 *  directory. runConditions derives the record key from every condition except the bases, the working directory and
 *  PER_RUN_OPTIONS. */
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
 *  working directory. The bases and the working directory determine the dependency roots, and the content of the roots
 *  determines the state. */
export function runConditions(c: TRunConditions): string {
	const options = Object.fromEntries(Object.entries(c.options).filter(([k]) => !PER_RUN_OPTIONS.has(k)));
	const keyed = {
		configPath: path.resolve(c.configPath),
		specl: c.specl,
		filter: [...c.filter],
		options,
		moduleOptions: c.moduleOptions,
		policy: c.policy ?? null,
		withSteppers: [...(c.withSteppers ?? [])],
	};
	return createHash("sha256").update(stable(keyed)).digest("hex").slice(0, 16);
}

type TVerification = {
	/** The path of the record file. */
	file: string;
	/** The key of this way of running the group. */
	conditions: string;
	/** The feature filter, comma-joined as the record stores it. */
	filter: string;
	/** The digest of the present content of every dependency. */
	state: string;
	/** The dependency directories that dependencyState reads. */
	roots: string[];
};

/** Returns the present state of a group's dependencies with the record file, the key of the given conditions, the filter
 *  and the dependency roots. Returns undefined where the state can't be read. A caller then runs the group without
 *  consulting the record and doesn't record the outcome. */
export function verificationOf(c: TRunConditions): TVerification | undefined {
	const configDir = path.dirname(path.resolve(c.configPath));
	const roots = dependencyRoots(c.specl, c.bases, configDir, c.cwd);
	const state = dependencyState(roots, c.specl.environments ?? []);
	if (state === undefined) return undefined;
	return { file: path.join(configDir, VERIFIED_FILE), conditions: runConditions(c), filter: c.filter.join(","), state, roots };
}

function readRecord(file: string): TVerifiedRecord {
	if (!nodeFS.existsSync(file)) return {};
	return JSON.parse(nodeFS.readFileSync(file, "utf-8")) as TVerifiedRecord;
}

const writeRecord = (file: string, record: TVerifiedRecord): void => nodeFS.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`);

/** Returns the outcome and feature count of the group's last run under these conditions against its present state.
 *  Returns undefined where the record doesn't hold that run or where the entry's outcome isn't passed or failed. */
export function outcomeAgainst(v: TVerification): { outcome: TOutcome; features: number } | undefined {
	const held = readRecord(v.file)[v.conditions];
	if (!held || held.state !== v.state || (held.outcome !== "passed" && held.outcome !== "failed")) return undefined;
	return { outcome: held.outcome, features: held.features };
}

/** Writes the group's outcome and feature count against its present state under these conditions. */
export function recordOutcome(v: TVerification, outcome: TOutcome, features: number): void {
	const record = readRecord(v.file);
	record[v.conditions] = { state: v.state, outcome, features, filter: v.filter };
	writeRecord(v.file, record);
}

/** Deletes the recorded run under these conditions. A run that didn't reach its features isn't evidence about the state. */
export function forgetOutcome(v: TVerification): void {
	const record = readRecord(v.file);
	if (!(v.conditions in record)) return;
	delete record[v.conditions];
	writeRecord(v.file, record);
}

/** Deletes recorded runs so a group's features run again in any state. Without a filter, it deletes the record file.
 *  With a filter, it deletes the runs narrowed to that filter and the runs of the whole group, because a run of the
 *  whole group includes those features. */
export function forgetOutcomes(configDir: string, filter?: string): void {
	const file = path.join(configDir, VERIFIED_FILE);
	if (!nodeFS.existsSync(file)) return;
	if (!filter) {
		nodeFS.rmSync(file);
		return;
	}
	const record = readRecord(file);
	for (const [key, held] of Object.entries(record)) if (held.filter === filter || held.filter === "") delete record[key];
	writeRecord(file, record);
}
