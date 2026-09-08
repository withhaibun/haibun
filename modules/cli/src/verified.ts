/**
 * The record of how a group of features last ran against the state of what it depends on, and the decision whether
 * to run it again.
 *
 * A run is evidence about that state. A group whose dependencies changed has no run against the state it has now,
 * and runs. What a reader of the record does with a run against the present state is the reader's: a person retrying
 * a group skips one that passed and runs one that failed, since a failure is what one retries; an agent is refused
 * either, since a second run over unchanged features is a loop. The record is kept beside the group's configuration
 * and is about the working tree it was written in, so it is that tree's alone and not committed.
 *
 * A run of statements, or a rehearsal, verifies the group against nothing, and neither reads the record nor writes
 * it. A run narrowed to some of the features, run under a policy, or given steppers beyond its configuration is
 * recorded under those conditions, as a run of its own.
 */
import { createHash } from "node:crypto";
import nodeFS from "node:fs";
import path from "node:path";
import type { TSpecl } from "@haibun/core/lib/execution.js";
import type { TRunPolicyConfig } from "@haibun/core/run-policy/run-policy-types.js";
import { VERIFIED_FILE, dependencyRoots, dependencyState } from "@haibun/core/lib/util/node/dependency-state.js";

/** How a group ran: every feature passed, or one did not. */
export type TOutcome = "passed" | "failed";

/** A recorded run: against which state, how it went, how many features it ran, and the features it was narrowed to.
 *  Keyed by the run's own conditions. Nothing that varies between two runs of one state is kept, so a record changes
 *  only when what it records does. */
export type TVerifiedRecord = Record<string, { state: string; outcome: TOutcome; features: number; filter: string }>;

/** Everything that decides what a run of a group is: where its configuration is and what it says, the directory the
 *  run is made from, the features it is narrowed to, the options it is given, the policy it runs under and the
 *  steppers added beyond its configuration. Two runs alike in all of these would answer alike. */
export type TRunConditions = {
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

/** Options that vary per run without changing what runs or what it shows, so they are no part of what a run is
 *  recorded against: the run's key, its description, and whether it stays up afterwards. */
const PER_RUN_OPTIONS = new Set(["KEY", "DESCRIPTION", "STAY"]);

/** A stable serialization: the same conditions give the same text whatever order their keys were written in. */
const stable = (value: unknown): string => JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** What distinguishes one way of running a group from another, as a key. */
export function runConditions(c: TRunConditions): string {
	const options = Object.fromEntries(Object.entries(c.options).filter(([k]) => !PER_RUN_OPTIONS.has(k)));
	const keyed = { configPath: path.resolve(c.configPath), specl: c.specl, filter: [...c.filter], options, moduleOptions: c.moduleOptions, policy: c.policy ?? null, withSteppers: [...(c.withSteppers ?? [])] };
	return createHash("sha256").update(stable(keyed)).digest("hex").slice(0, 16);
}

export type TVerification = {
	/** Where the record lives. */
	file: string;
	/** The key of this way of running the group. */
	conditions: string;
	/** The features this run is narrowed to, as recorded. */
	filter: string;
	/** The state of every dependency now. */
	state: string;
	/** The directories the state was read from. */
	roots: string[];
};

/** The state a group would be verified against now: its dependencies and their content, keyed by this run's conditions.
 *  Undefined where the state cannot be read, so such a run is a run like any other, recorded against nothing. */
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

/** How this group last ran against its present state under these conditions, if it has run against it. A record that
 *  does not say how the run went is no record of a run. */
export function outcomeAgainst(v: TVerification): { outcome: TOutcome; features: number } | undefined {
	const held = readRecord(v.file)[v.conditions];
	if (!held || held.state !== v.state || (held.outcome !== "passed" && held.outcome !== "failed")) return undefined;
	return { outcome: held.outcome, features: held.features };
}

/** Record how the group ran against its present state. */
export function recordOutcome(v: TVerification, outcome: TOutcome, features: number): void {
	const record = readRecord(v.file);
	record[v.conditions] = { state: v.state, outcome, features, filter: v.filter };
	writeRecord(v.file, record);
}

/** Forget any run under these conditions: a run that did not get as far as its features says nothing about the state. */
export function forgetOutcome(v: TVerification): void {
	const record = readRecord(v.file);
	if (!(v.conditions in record)) return;
	delete record[v.conditions];
	writeRecord(v.file, record);
}

/** Forget how a group's features last ran, so they run again whatever their state: every run of the group, or, where
 *  features are named, the runs narrowed to those and the runs of the whole group, which include them. */
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
