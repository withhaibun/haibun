/**
 * The composition root of the cli: what a run reads and writes through, what a supervisor starts its instances and runs
 * through and the hosts it calls, and the sign-ins this process holds for the sites of the instances it starts, which every call it makes to such a
 * site carries.
 */
import type { TBasicAuthUser } from "@haibun/core/lib/domains/basic-auth.js";
import { holdSignIn, releaseSignIn } from "@haibun/core/lib/transport/adapters/rpc-call.js";
import { RpcClient } from "@haibun/core/lib/transport/adapters/rpc-client.js";
import { remoteSteps } from "@haibun/core/lib/transport/root.js";
import { getSteppers } from "@haibun/core/lib/adapters/workspace-lib.js";
import { actualityClock, featureSource } from "@haibun/core/lib/actuality/root.js";
import { consolePrompter } from "@haibun/core/lib/prompts/root.js";
import { eventSink } from "@haibun/core/lib/steps/root.js";
import * as actualities from "./adapters/actualities.js";
import { fileSystem, processes } from "./adapters/processes.js";
import type { TCliPorts, THosts, TSupervisorPorts } from "./ports.js";

/** The timeout of one handshake attempt. A starting child doesn't respond before it listens. It responds quickly once it listens, so a short attempt suffices. */
const BEGIN_TIMEOUT_MS = 1_500;

/** The sign-in each call to an instance's origin carries, held until the instance stops. */
export const instanceSignIns = { hold: (origin: string, user: TBasicAuthUser): void => holdSignIn(origin, user), release: (origin: string): void => releaseSignIn(origin) };

/** What a run of the cli reads and writes through: this process's file system, features, steppers, clock, console and events. */
export const cliPorts = (): TCliPorts => ({
	fs: fileSystem,
	features: featureSource(),
	steppers: getSteppers,
	actualities,
	clock: actualityClock(),
	prompter: consolePrompter(),
	events: eventSink(),
});

/** One handshake attempt with an instance, and the steps of a host. */
const hosts: THosts = { begin: (origin) => new RpcClient({ baseUrl: origin, timeoutMs: BEGIN_TIMEOUT_MS, retry: { maxAttempts: 1 } }).handshake(), steps: remoteSteps };

/** The ports that fork a supervisor's instances and runs, read their configurations and actualities, and call their hosts. */
export const supervisorPorts: TSupervisorPorts = { fs: fileSystem, actualities, processes, hosts };
