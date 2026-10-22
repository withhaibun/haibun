/**
 * The ports of the cli: the file system it reads configurations, policies and environment files through, the source of the
 * features it runs, the steppers it loads, a group's actualities file, the processes a supervisor starts, and the clock,
 * prompter and event sink of the actuality it runs, and the hosts a supervisor calls.
 */
import type { ChildProcess } from "node:child_process";
import type { getSteppers, TFileSystem } from "@haibun/core/lib/adapters/workspace-lib.js";
import type { TClock, TFeatureSource } from "@haibun/core/lib/actuality/ports.js";
import type { IPrompter } from "@haibun/core/lib/prompts/ports.js";
import type { TEventSink } from "@haibun/core/lib/steps/ports.js";
import type { TRequestSigner } from "@haibun/core/lib/domains/authority-types.js";
import type { THandshake } from "@haibun/core/lib/transport/domains/rpc-wire.js";
import type { TRemoteSteps } from "@haibun/core/lib/transport/ports.js";
import type * as actualities from "./adapters/actualities.js";

/** A group's actualities file: an actuality's place in it, the outcome it records, and the records it writes and clears. */
export type TActualities = Pick<typeof actualities, "verificationOf" | "outcomeAgainst" | "recordActuality" | "forgetOutcome" | "forgetOutcomes">;

/** The processes a supervisor starts: a forked cli that ends with this process, its termination, and what holds a port. */
export type TProcesses = {
	forkCli(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess;
	terminate(child: ChildProcess): Promise<void>;
	occupant(port: number): Promise<string | undefined>;
};

/** The file system a run reads its configurations, policies and environment files through, and where a package's export is, which
 *  a config names as the config it extends and a command line names as a base. */
export type TConfigFiles = TFileSystem & { packageLocation(name: string, from: string): string };

/** The ports a run of the cli reads and writes. */
export type TCliPorts = {
	fs: TConfigFiles;
	features: TFeatureSource;
	steppers: typeof getSteppers;
	actualities: TActualities;
	clock: TClock;
	prompter: IPrompter;
	events: TEventSink;
};

/** The hosts a supervisor calls: one handshake attempt with an instance, and the steps of a host, each call signed through `sign`. */
export type THosts = { begin(origin: string): Promise<THandshake>; steps(origin: string, sign: TRequestSigner): TRemoteSteps };

/** The ports that fork the instances and runs of a supervisor, read their configurations and actualities, and call their hosts. */
export type TSupervisorPorts = Pick<TCliPorts, "fs" | "actualities"> & { processes: TProcesses; hosts: THosts };
