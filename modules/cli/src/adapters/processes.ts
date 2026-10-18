/**
 * This process's file system, and the processes a supervisor starts: a forked cli, which ends with this process.
 */
import nodeFS from "node:fs";
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { superviseChild, terminate } from "@haibun/core/lib/adapters/owned-children.js";
import { describePortOccupant, PROBE_TIMEOUT_MS } from "@haibun/core/lib/adapters/port-occupant.js";
import type { TFileSystem } from "@haibun/core/lib/adapters/workspace-lib.js";
import type { TProcesses } from "../ports.js";

export const fileSystem: TFileSystem = nodeFS;

export const processes: TProcesses = {
	// execArgv: [] runs the built cli in plain node, without a test runner's loader flags.
	forkCli: (args, { cwd, env }) => {
		const child = fork(createRequire(import.meta.url).resolve("@haibun/cli"), args, { cwd, env, silent: true, execArgv: [] });
		superviseChild(child);
		return child;
	},
	terminate,
	occupant: (port) => describePortOccupant(port, PROBE_TIMEOUT_MS),
};
