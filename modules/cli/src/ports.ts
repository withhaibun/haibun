/**
 * The ports of the cli: the file system it reads configurations, policies and environment files through, the source of the
 * features it runs, the steppers it loads, a group's actualities file, the processes a supervisor starts, and the clock,
 * prompter and event sink of the actuality it runs.
 */
import type { ChildProcess } from "node:child_process";
import type { getSteppers, TFileSystem } from "@haibun/core/lib/adapters/workspace-lib.js";
import type { TClock, TFeatureSource } from "@haibun/core/lib/actuality/ports.js";
import type { IPrompter } from "@haibun/core/lib/prompts/ports.js";
import type { TEventSink } from "@haibun/core/lib/steps/ports.js";
import type * as actualities from "./adapters/actualities.js";

/** A group's actualities file: an actuality's place in it, the outcome it records, and the records it writes and clears. */
export type TActualities = Pick<typeof actualities, "verificationOf" | "outcomeAgainst" | "recordActuality" | "forgetOutcome" | "forgetOutcomes" | "varianceLine">;

/** The processes a supervisor starts: a forked cli that ends with this process, its termination, and what holds a port. */
export type TProcesses = {
	forkCli(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess;
	terminate(child: ChildProcess): Promise<void>;
	occupant(port: number): Promise<string | undefined>;
};

/** The ports a run of the cli reads and writes. */
export type TCliPorts = {
	fs: TFileSystem;
	features: TFeatureSource;
	steppers: typeof getSteppers;
	actualities: TActualities;
	clock: TClock;
	prompter: IPrompter;
	events: TEventSink;
};

/** The ports that fork the instances and runs of a supervisor, and read their configurations and actualities. */
export type TSupervisorPorts = Pick<TCliPorts, "fs" | "actualities"> & { processes: TProcesses };
