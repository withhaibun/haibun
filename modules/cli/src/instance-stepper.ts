/**
 * InstanceStepper supervises sibling haibun processes of two kinds. An instance serves, and a run executes features.
 * `start a haibun instance from {where} on port {port} as host {hostId}` forks the cli.js that an operator runs.
 * The child reads the config directory that a deployment uses.
 * The child serves because its feature ends with `this feature runs as a service until stopped`.
 * Readiness is the action.begin handshake. Federation and remote steppers use the same handshake.
 * The step's products carry the instance's url, site principal and hostId.
 * The operator assigns hostIds: the feature states the id, and the handshake verifies that the child took it.
 * endFeature terminates the children when the feature closes. `superviseChild` terminates any remaining child when this process ends.
 *
 * A run is the other kind of child: the same cli.js, forked with a feature filter.
 * startRun doesn't await a run, so the caller can act while it executes.
 * The caller is a person at a terminal or an agent that selects its next step.
 * A run with a host above 0 stays up after its features finish, so a caller can still query what it produced.
 *
 * This process reads a run's events as they arrive. A run writes its events as NDJSON on its output.
 * Each chunk moves the actuality machine whose state a caller reads: the features that ran, the step count, the
 * failures, and whether the child's execution has ended.
 * This process also keeps the child's process output as a bounded tail that a caller reads from a cursor.
 * That output is the only record of a run that fails before it serves. The bound keeps a long run's output from growing without limit.
 * `SseSubscriber` subscribes to a serving run that this process didn't fork.
 *
 * Runs are held in their own map. endFeature terminates runs under the same condition as instances.
 */
import type { THandshake } from "@haibun/core/lib/rpc-wire.js";
import { fork, type ChildProcess } from "child_process";
import { createRequire } from "module";
import { superviseChild, terminate } from "@haibun/core/lib/owned-children.js";
import { describePortOccupant, PROBE_TIMEOUT_MS } from "@haibun/core/lib/port-occupant.js";
import nodeFS, { existsSync, readFileSync } from "fs";
import { parseEnv } from "node:util";
import path from "path";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import type { TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionNotOK, actionOKWithProducts, perProcessOptionNames } from "@haibun/core/lib/util/index.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { RpcClient } from "@haibun/core/lib/rpc-client.js";
import { instanceSignIns } from "./root.js";
import { BASIC_AUTH_OPTION, basicAuthUsers, type TBasicAuthUser } from "@haibun/core/lib/basic-auth.js";
import { RemoteStepperProxy } from "@haibun/core/lib/remote-stepper-proxy.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { MODULE_OPTION_PREFIX, BASE_PREFIX, NDJSON, OK, ONCE, STAY, STAY_ALWAYS } from "@haibun/core/schema/protocol.js";
import { HAIBUN_HOST_ID_ENV } from "@haibun/core/lib/host-id.js";
import { type TRunOutcome, emptyOutcome, failureLine, readRunOutput, runSummary } from "./run-outcome.js";
import { LEVEL_STATUS, executionEnded } from "@haibun/core/lib/actuality/machines/actuality.js";
import { getConfigFromBase, processBaseEnvToOptionsAndErrors } from "./lib.js";
import { outcomeAgainst, verificationOf, type TOutcome } from "./verified.js";
import { DOMAIN_FILE_PATH, DOMAIN_NUMBER, NameSchema } from "@haibun/core/lib/domains.js";

/** Environment names of the per-process options that core owns: whether a process stays up, and whether it skips a group
 *  that passed. NDJSON_ENV selects NDJSON events on a child's output. `HAIBUN_HOST_ID_ENV` holds a process's host id.
 *  Each other per-process option declares itself (see `perProcessOptionNames`). */
const STAY_ENV = `${BASE_PREFIX}${STAY}`;
const ONCE_ENV = `${BASE_PREFIX}${ONCE}`;
const NDJSON_ENV = `${BASE_PREFIX}${NDJSON}`;

/**
 * The environment name an instance reads its serving port from. It is the web server's own option.
 * This file names it because a launcher assigns a port to an instance whose steppers the launcher doesn't hold.
 * The launcher returns that port to its caller as the instance's serving port, so the assignment can't depend on the
 * steppers the launcher registers.
 */
const INSTANCE_PORT_ENV = `${MODULE_OPTION_PREFIX}WEBSERVERSTEPPER_PORT`;

const READY_DEADLINE_MS = 30_000;
/** The timeout of one handshake attempt. A starting child doesn't respond before it listens. It responds quickly once it listens, so a short attempt suffices. */
const BEGIN_TIMEOUT_MS = 1_500;
const READY_POLL_MS = 300;
const STDERR_TAIL_CHARS = 4_000;
/** The number of characters of a run's output that RunTail keeps. RunTail drops older output. A read from a cursor
 *  before the kept output returns the dropped count, so a gap doesn't read as complete output. */
const RUN_TAIL_CHARS = 200_000;

/** The HAIBUN_ENV variable a launched instance reads to address its launcher: `use store at $LAUNCHED_FROM$ …`. */
const LAUNCHED_FROM = "LAUNCHED_FROM";

/**
 * The capabilities a caller must hold to supervise a process, as ZCAP-LD `allowedAction` values.
 *
 * Each value names one action. The step that performs the action declares it.
 * A step that calls another step declares the action of the step it calls, so a caller can't perform an action through
 * another step when it can't perform that action directly.
 * Grants are per action. "May start runs" and "may stop runs" are separate grants, and either can be revoked while the other remains.
 *
 * `dispatchStep` performs the check in the same way for a feature line, an RPC call, an MCP tool call and a model's tool call.
 * The caller's capability comes from the authority the step executes under, so the steps here don't read one.
 */
export const SUPERVISOR_CAPABILITIES = {
	/** Start a serving instance from a directory of features. */
	launch: "Instance:launch",
	/** Start a run of features. A run executes its features' steps on this machine. */
	run: "Instance:run",
	/** Read a run's output verbatim, wait for a run, and list the instances and runs this process started. */
	read: "Instance:read",
	/** End a run or an instance this process started. */
	stop: "Instance:stop",
} as const;

const instanceStartedSchema = z.object({ url: z.string(), site: z.string(), hostId: z.number() });
/** The products that starting a run and reading a run return. Both schemas are exported so a caller parses the products rather than asserting a shape. */
export const runStartedSchema = z.object({ run: z.string(), where: z.string(), filter: z.string() });
export const runReadSchema = z.object({
	run: z.string(),
	status: z.string(),
	exitCode: z.number().nullable(),
	cursor: z.number(),
	output: z.string(),
	dropped: z.number(),
	// The counts a run has reported so far. They accrue from every chunk of its output, not from the kept tail, so they
	// stay complete when the output exceeds the tail.
	features: z.number(),
	steps: z.number(),
	/** The status of a run's execution, as the actuality machine that read its events holds it. A standing run's
	 *  execution ends and its process keeps serving without exiting, so a caller waits on this status rather than on an exit. */
	execution: z.enum(LEVEL_STATUS),
	failed: z.number(),
	/** The first failed step, as its id, its text and its failure message, where a step failed. */
	firstFailure: z.string().optional(),
	summary: z.string(),
	/** Where a run wrote its report, where it wrote one. */
	report: z.string().optional(),
});

/**
 * The kept output of a run or an instance. It holds a bounded tail that a reader reads from a cursor, and it counts the characters it drops.
 * A read from a cursor before the kept output returns the number of requested characters that were dropped.
 */
export class RunTail {
	/** The kept chunks, in arrival order. `since` joins them on a read, so `append` doesn't copy the whole tail for each
	 *  line a run prints. */
	private chunks: string[] = [];
	private keptChars = 0;
	private droppedChars = 0;
	constructor(private readonly keep: number = RUN_TAIL_CHARS) {}

	append(text: string): void {
		if (text === "") return;
		// Only a chunk longer than the tail is sliced to its end. The loop below drops older chunks whole.
		if (text.length > this.keep) {
			this.droppedChars += text.length - this.keep;
			text = text.slice(-this.keep);
		}
		this.chunks.push(text);
		this.keptChars += text.length;
		while (this.keptChars > this.keep) {
			const dropped = this.chunks.shift() ?? "";
			this.keptChars -= dropped.length;
			this.droppedChars += dropped.length;
		}
	}

	/** Returns the output logged after `cursor`, the cursor to read from next, and the number of requested characters that were dropped. */
	since(cursor: number): { output: string; cursor: number; dropped: number } {
		const from = Math.max(0, cursor - this.droppedChars);
		return { output: this.chunks.join("").slice(from), cursor: this.droppedChars + this.keptChars, dropped: Math.max(0, this.droppedChars - cursor) };
	}
}

/**
 * The environment a child process starts with. `port` sets the port the child's web server listens on, so two children
 * can execute at once. `standing` sets whether the child stays up after its features finish.
 * The two are independent: a run can take another port and still end when its features finish.
 * This function sets both rather than letting the child inherit them. An inherited port would put the child on the
 * supervisor's own port, and an inherited STAY would keep the child up indefinitely when the supervisor stays up.
 */
export function runEnvironment(inherited: NodeJS.ProcessEnv, port: number, standing: boolean, hostId?: number, perProcess: string[] = []): NodeJS.ProcessEnv {
	const env = { ...inherited };
	// A child doesn't inherit a per-process option. Each option declares that it is per-process.
	for (const name of perProcess) delete env[name];
	delete env[STAY_ENV];
	delete env[ONCE_ENV];
	delete env[HAIBUN_HOST_ID_ENV];
	// The child's web server takes the given port. Another per-process port, such as a monitor's, stays unset, since two
	// servers in one child can't share a port.
	if (port > 0) env[INSTANCE_PORT_ENV] = String(port);
	if (standing) env[STAY_ENV] = STAY_ALWAYS;
	// A child with a host id is a separate host. Its seqPaths identify the host that produced them, and this process
	// can register its steps under that id.
	if (hostId !== undefined) env[HAIBUN_HOST_ID_ENV] = String(hostId);
	// This process reads the child's output, so the child writes its events as well as its formatted log. Only the
	// events carry the failures, their seqPaths and the final outcome.
	env[NDJSON_ENV] = "true";
	return env;
}

/** Returns the environment of a run started in `cwd`. A variable in `env` takes precedence over the same name in the
 *  .env file in `cwd`. A run reads its own .env file with the same precedence. */
function environmentIn(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const dotenv = path.join(cwd, ".env");
	if (!existsSync(dotenv)) return env;
	return { ...parseEnv(readFileSync(dotenv, "utf-8")), ...env };
}

/** Returns the recorded outcome of a run's features against their present state, under the conditions a run would receive.
 *  It computes those conditions as a run does: from `cwd`, with the environment a run reads there.
 *  Returns undefined when the features haven't executed against that state, and throws where the configuration doesn't read.
 *  startRun forks the child where it returns undefined. */
export function verifiedRun(config: string, dir: string, filter: string, cwd: string, env: NodeJS.ProcessEnv): TOutcome | undefined {
	const specl = getConfigFromBase([dir], nodeFS);
	const { options, moduleOptions } = processBaseEnvToOptionsAndErrors(environmentIn(cwd, env), specl);
	const v = verificationOf({ configPath: config, specl, bases: [dir], cwd, filter: filter ? filter.split(",") : [], options, moduleOptions });
	return v === undefined ? undefined : outcomeAgainst(v)?.outcome;
}

/** Returns the first user that the BASIC_AUTH option lists for the web server of a run in `dir`, or undefined when the option is unset.
 *  It reads the option as a run does: from `env`, the .env file in `cwd`, and the config. */
function signInOf(dir: string, cwd: string, env: NodeJS.ProcessEnv): TBasicAuthUser | undefined {
	const specl = getConfigFromBase([dir], nodeFS);
	const listed = processBaseEnvToOptionsAndErrors(environmentIn(cwd, env), specl).moduleOptions[BASIC_AUTH_OPTION];
	return listed ? basicAuthUsers(String(listed))[0] : undefined;
}

/** A supervised run: the child, its output tail, the outcome accrued from its events, its exit code, and the callbacks
 *  waiting for its features to finish. `ended` is null until the child exits. */
type TRun = { child: ChildProcess; tail: RunTail; outcome: TRunOutcome; ended: number | null; waiters: Array<() => void> };

/** The arguments an instance was launched with. restartInstance launches the same instance again from them. */
type TLaunch = { dir: string; config: string; port: number; hostId: number };

/** Whether a run is running or ended. */
const runStatus = (held: TRun): string => (held.ended === null ? "running" : "ended");

/** The domain of the instances and runs this process started. */
const DOMAIN_INSTANCES = "haibun-instances";
/** The domain of the products that starting an instance returns. */
const DOMAIN_INSTANCE_STARTED = "instance-started";
/** The domains of a run's name, its feature filter, and the products that starting, reading and stopping a run return.
 *  The test double of this supervisor in test-runner-stepper.test.ts declares them too. */
export const RUN_DOMAIN = { started: "run-started", read: "run-read", stopped: "run-stopped", name: "run-name", featureFilter: "feature-filter" } as const;
/** Whether a part of a feature filter compiles as a regular expression. haibun-cli matches each part against a feature's path. */
const isPattern = (part: string): boolean => {
	try {
		new RegExp(part);
		return true;
	} catch {
		return false;
	}
};
/** The domain of a feature filter: patterns of feature paths separated by commas, as haibun-cli takes them. An empty filter selects every feature. */
export const featureFilterDomainDefinition: TDomainDefinition = {
	selectors: [RUN_DOMAIN.featureFilter],
	schema: z
		.string()
		.refine(
			(filter) => filter.split(",").every(isPattern),
			"has a part that isn't a regular expression. A lone * isn't a regular expression, and .* matches every path. Correct that part, or leave the filter empty to run every feature",
		),
	description:
		"Comma-separated regular expressions that select the features a run executes by path. haibun-cli takes the same form. Two examples are graph and a.*b. An empty filter runs every feature",
};
export const runDomainDefinitions: TDomainDefinition[] = [
	{ selectors: [RUN_DOMAIN.name], schema: NameSchema, description: "The name of a started run. Reading, waiting for and stopping a run take this name" },
	featureFilterDomainDefinition,
	{ selectors: [RUN_DOMAIN.started], schema: runStartedSchema, description: "A run a process started, with its directory and feature filter" },
	{ selectors: [RUN_DOMAIN.read], schema: runReadSchema, description: "A run's output since a cursor, its status, and the outcome accrued from its events" },
	{ selectors: [RUN_DOMAIN.stopped], schema: z.object({ run: z.string() }), description: "A run a process ended" },
];
/** The instances and runs this process started. It supervises them until they end. */
const InstancesSchema = z.object({
	instances: z
		.array(z.object({ hostId: z.number(), origin: z.string(), label: z.string() }))
		.describe("Each instance this process launched and still supervises: its host id, its origin, and the directory it was launched from."),
	runs: z.array(z.object({ run: z.string(), status: z.string() })).describe("Each run this process started, and whether it is running or ended."),
});

/** Returns an instance's response to the action.begin handshake, or undefined while the instance doesn't accept the call.
 *  A starting instance refuses the connection or doesn't respond until it listens, so a caller waiting on it calls again. */
async function begins(rpc: RpcClient): Promise<THandshake | undefined> {
	// A response that fails the handshake schema is rethrown. Any other failure means the instance doesn't accept calls yet.
	return await rpc.handshake().catch((e: unknown) => {
		if (e instanceof z.ZodError) throw e;
		return undefined;
	});
}

/** Returns the resolved directory and its config.json. Throws with `doing` as the prefix when the directory doesn't hold a config.json. */
function configIn(doing: string, where: string): { dir: string; config: string } {
	const dir = path.resolve(String(where));
	const config = path.join(dir, "config.json");
	if (!existsSync(config)) throw new Error(`${doing}: ${dir} doesn't hold a config.json`);
	return { dir, config };
}

export default class InstanceStepper extends AStepper implements IHasCycles {
	description = "Start and supervise sibling haibun instances (forked cli.js, readiness via action.begin, terminated at endFeature)";

	/** The steppers this process was set up with. Their declarations name the options a child doesn't inherit. */
	private steppers: AStepper[] = [];
	/** The origins of the sign-ins this process holds. endFeature releases them when it terminates the children. */
	private readonly signedInAt = new Set<string>();

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	private children: Array<{ child: ChildProcess; label: string; launch: TLaunch }> = [];
	/** Protected so a test subclass can hold a run without a child process. Code outside the class hierarchy can't access it. */
	protected runs = new Map<string, TRun>();

	/** Returns the TRun this process holds under the name `run`. Throws with `doing` as the prefix when this process didn't start a run of that name. */
	private startedRun(doing: string, run: string): TRun {
		const held = this.runs.get(run);
		if (!held) throw new Error(`${doing}: this process didn't start a run "${run}"`);
		return held;
	}

	/** Returns the instance this process launched on `port`. Throws with `doing` as the prefix when this process didn't launch one there. */
	private launchedInstance(doing: string, port: number): { child: ChildProcess; label: string; launch: TLaunch } {
		const held = this.children.find((c) => c.launch.port === port);
		if (!held) throw new Error(`${doing}: this process didn't launch an instance on port ${port}`);
		return held;
	}
	/** getConcerns declares the instance and run domains. endFeature terminates every child and releases the sign-ins when the feature closes. */

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				{ selectors: [DOMAIN_INSTANCES], schema: InstancesSchema, description: "The instances and runs a process started" },
				{ selectors: [DOMAIN_INSTANCE_STARTED], schema: instanceStartedSchema, description: "An instance a process started, with its url, its site principal and its host id" },
				...runDomainDefinitions,
			],
		}),
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return;
			await Promise.all([...this.children.map(({ child }) => terminate(child)), ...[...this.runs.values()].map((r) => terminate(r.child))]);
			for (const origin of this.signedInAt) instanceSignIns.release(origin);
			this.signedInAt.clear();
			this.children = [];
			this.runs.clear();
		},
	};

	steps = {
		startInstance: {
			gwta: `start a haibun instance from {where: ${DOMAIN_FILE_PATH}} on port {port: ${DOMAIN_NUMBER}} as host {hostId: ${DOMAIN_NUMBER}}`,
			capability: SUPERVISOR_CAPABILITIES.launch,
			productsDomain: DOMAIN_INSTANCE_STARTED,
			action: async ({ where, port, hostId }: { where: string; port: number; hostId: number }) => {
				return await this.launch({ ...configIn("start instance", where), port, hostId });
			},
		},
		restartInstance: {
			gwta: `restart the haibun instance on port {port: number}`,
			capability: SUPERVISOR_CAPABILITIES.launch,
			description:
				"Stop an instance this process launched, and launch it again with the same directory, config, port and host id. The step waits until the instance serves. An instance serves its source as it was when the instance started, so a change to that source takes effect after a restart. The process that restarts an instance is never the instance it restarts.",
			productsDomain: DOMAIN_INSTANCE_STARTED,
			action: async ({ port }: { port: number }) => {
				const held = this.launchedInstance("restart instance", port);
				await terminate(held.child);
				this.children = this.children.filter((c) => c !== held);
				return await this.launch(held.launch);
			},
		},
		reachInstance: {
			gwta: `reach the steps of the haibun instance on port {port: number}`,
			description:
				"Register the steps of an instance this process launched, under the instance's host id. A caller then calls one as `on host {id}, <step>`, and it is dispatched and gated as a local step is. The instance lists only the steps that this process's capabilities at the instance allow. Reading the steps requires a read capability, and the instance delegates that capability to its launcher's key. The steps stay registered across a restart, since a restart keeps the instance's port and host id.",
			action: async ({ port }: { port: number }) => {
				this.launchedInstance("reach instance", port);
				await this.registerHost(localOrigin(port));
				return OK;
			},
		},
		startRun: {
			gwta: `start a haibun run of {where: ${DOMAIN_FILE_PATH}} matching {filter: ${RUN_DOMAIN.featureFilter}} from {from: ${DOMAIN_FILE_PATH}} on port {port: ${DOMAIN_NUMBER}} as run {run: ${RUN_DOMAIN.name}} host {hostId: ${DOMAIN_NUMBER}}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description:
				"Run features from a directory in a child of this process. The filter selects the features. The step doesn't await the child, so the caller can watch it while it executes (see `read the haibun run`). The child starts in the `from` directory, because a config's relative stepper paths and a base's served files resolve against the directory a run starts in. That directory is usually the base itself. For a base whose runs start in its parent directory, it is that parent. The child's web server takes the given port, so two runs can execute at once without both taking a default port. Port zero leaves a run on the ports its features declare. With host zero, a run ends when its features finish. With a host above zero, a run stays up and takes that host id, and this process registers its steps. A caller then calls one of those steps as `on host {id}, <step>`, without a second calling mechanism. A run that stays up needs a port of its own, since a caller can't reach a run that doesn't have an address.",
			productsDomain: RUN_DOMAIN.started,
			action: async ({ where, filter, from, port, run, hostId }: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				const standing = hostId > 0;
				if (standing && port <= 0) return actionNotOK("start run: a run with a host above 0 stays up and needs a port above 0. Pass a port, or use host 0");
				const started = await this.startRun({ where, filter, from, port, run, standing, hostId: standing ? hostId : undefined });
				if (!started.ok || !standing) return started;
				// Callers call a standing run's steps. A standing run whose steps don't register fails at start rather than at a
				// later call. The child is terminated so it doesn't hold a port that a caller can't reach.
				const registered = await this.registerRunHost(run, port);
				if (!registered) {
					const held = this.runs.get(run);
					const said = held ? held.tail.since(0).output.slice(-STDERR_TAIL_CHARS) : "";
					if (held) await terminate(held.child);
					this.runs.delete(run);
					return actionNotOK(
						`start run: "${run}" didn't complete the handshake as host ${hostId} on port ${port}. This process stopped it. Correct the cause its output reports${said ? `\n${said}` : ""}`,
					);
				}
				return started;
			},
		},
		showInstances: {
			read: true,
			capability: SUPERVISOR_CAPABILITIES.read,
			gwta: "show the haibun instances",
			description:
				"List the instances this process launched and the runs it started. Each instance entry holds its host id, its origin and its label. Each run entry holds its status: running or ended.",
			productsDomain: DOMAIN_INSTANCES,
			action: () =>
				Promise.resolve(
					actionOKWithProducts({
						instances: this.children.map(({ label, launch }) => ({ hostId: launch.hostId, origin: localOrigin(launch.port), label })),
						runs: [...this.runs].map(([run, held]) => ({ run, status: runStatus(held) })),
					}),
				),
		},
		readRun: {
			gwta: `read the haibun run {run: ${RUN_DOMAIN.name}} since {cursor: number}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			// The caller receives the output in the products. The retained event records the output's length rather than
			// writing the text again.
			retainProducts: (products: Record<string, unknown>) => ({ ...products, output: `${String(products.output ?? "").length} chars` }),
			description:
				"A run's process output since a cursor, whether it is still running, and the counts and first failure accrued from its events. The process output is the only record of a run that fails before it serves. A serving run's events carry seqPaths and outcomes. The returned cursor is where the next read starts, so a read doesn't return the same output twice.",
			productsDomain: RUN_DOMAIN.read,
			action: ({ run, cursor }: { run: string; cursor: number }) => Promise.resolve(this.readRun(run, cursor)),
		},
		waitRun: {
			gwta: `wait for the haibun run {run: ${RUN_DOMAIN.name}} to end within {seconds: number} seconds`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Wait until a run exits or reports that its features finished, or until the timeout passes, then return. This process receives the child's exit event and its report that its features finished, so the step returns as soon as either arrives and the caller doesn't poll. The products have the same shape as readRun's. At the timeout the step returns the same products with a status of running. A timeout isn't a failure. The caller then waits again or stops it with `stop the haibun run`.",
			productsDomain: RUN_DOMAIN.read,
			action: ({ run, seconds, cursor }: { run: string; seconds: number; cursor: number }) => this.waitRun(run, seconds, cursor),
		},
		stopRun: {
			gwta: `stop the haibun run {run: ${RUN_DOMAIN.name}}`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			description: "End a run this process started, whether or not it has finished. A run left standing holds its port until it is stopped.",
			productsDomain: RUN_DOMAIN.stopped,
			action: async ({ run }: { run: string }) => {
				const held = this.startedRun("stop run", run);
				await terminate(held.child);
				this.runs.delete(run);
				return actionOKWithProducts({ run });
			},
		},
	} as const satisfies TStepperSteps;

	/** Forks the CLI with a feature filter and doesn't await the child. This process supervises the child, and readRun reads its output. */
	private async startRun({
		where,
		filter,
		from,
		port,
		run,
		standing,
		hostId,
	}: {
		where: string;
		filter: string;
		from: string;
		port: number;
		run: string;
		standing: boolean;
		hostId?: number;
	}) {
		if (this.runs.has(run)) return actionNotOK(`start run: this process already holds a run named "${run}". Read it, stop it, or choose another name`);
		const { dir, config } = configIn("start run", where);
		// A run given a port in use fails at boot, and its own output holds the EADDRINUSE error. This refusal describes
		// the process on the port and the remedy instead.
		if (port > 0) {
			const answering = await describePortOccupant(port, PROBE_TIMEOUT_MS);
			if (answering) return actionNotOK(`start run: port ${port} is already in use: ${answering}. Stop the process on that port, or choose another port`);
		}
		const cliEntry = createRequire(import.meta.url).resolve("@haibun/cli");
		// A port above zero makes a run addressable. A standing run also gets STAY, so its endpoint stays up after its
		// features finish. Port 0 leaves a run on the ports its features declare. A feature that asserts a default port
		// needs port 0. A run that isn't standing ends when its features end.
		const env = runEnvironment(process.env, port, standing, hostId, perProcessOptionNames(this.steppers));
		// A run whose features have a recorded outcome against their present dependencies isn't started, since it would
		// repeat that outcome. The child records each outcome with the conditions of its execution. verifiedRun computes
		// those conditions from the environment the child would receive, and looks up an outcome under them.
		// A run's starting directory determines how its relative paths resolve, so the caller passes it. An empty `from`
		// uses this process's directory.
		const cwd = from ? path.resolve(from) : process.cwd();
		if (!existsSync(cwd)) return actionNotOK(`start run: the starting directory ${cwd} doesn't exist. Pass an existing starting directory`);
		const ran = verifiedRun(config, dir, filter, cwd, env);
		if (ran)
			return actionNotOK(
				`start run: ${filter || "every feature"} in ${dir} ${ran} against its present dependencies. A new run would repeat that outcome. Change a dependency to run it again, or note that the group has changed.`,
			);
		if (port > 0) this.holdSignInAt(port, signInOf(dir, cwd, env));
		const child = fork(cliEntry, ["-c", config, dir, filter], { cwd, env, silent: true, execArgv: [] });
		superviseChild(child); // a standing run can outlive its feature, but not this process
		const held: TRun = { child, tail: new RunTail(), outcome: emptyOutcome(), ended: null, waiters: [] };
		const take = (data: Buffer): void => {
			const text = data.toString();
			held.tail.append(text);
			const wasFinished = executionEnded(held.outcome.actuality);
			readRunOutput(held.outcome, text);
			// A run's report that its execution ended wakes its waiters, whether or not it keeps serving.
			if (!wasFinished && executionEnded(held.outcome.actuality)) for (const wake of held.waiters.splice(0)) wake();
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		child.once("exit", (code) => {
			held.ended = typeof code === "number" ? code : -1;
		});
		this.runs.set(run, held);
		return actionOKWithProducts({ run, where: dir, filter });
	}

	/**
	 * Registers a standing run's steps in this process under its host id, once it completes the handshake. Returns false
	 * when it exits or the deadline passes first.
	 *
	 * A standing run is another host. RemoteStepperProxy reads the host id through the same handshake, fetches the
	 * host's step descriptors, and injects them into this registry under `{hostId}:{method}`. A caller then calls one of
	 * its steps as `on host {hostId}, <step>`, and it is dispatched and gated as a local step is. A run that doesn't serve
	 * doesn't register steps, since it doesn't respond to a call.
	 */
	private async registerRunHost(run: string, port: number): Promise<boolean> {
		const url = localOrigin(port);
		const answered = await this.awaitBegin(url, () => this.runs.get(run)?.ended !== null);
		if (!answered) return false;
		await this.registerHost(url);
		return true;
	}

	/** Holds the sign-in of `user` for the origin of `port`, and records the origin for endFeature to release.
	 *  Returns without holding a sign-in when `user` is undefined. */
	private holdSignInAt(port: number, user: TBasicAuthUser | undefined): void {
		if (!user) return;
		const url = localOrigin(port);
		instanceSignIns.hold(url, user);
		this.signedInAt.add(url);
	}

	/** Registers the steps of the host at `url` in this process, under the host id from its handshake. */
	private async registerHost(url: string): Promise<void> {
		const world = this.getWorld();
		const proxy = new RemoteStepperProxy(url);
		await proxy.setWorld(world, []);
		proxy.injectInto(runRegistry(world));
	}

	/** Waits until a child responds to the action.begin handshake, or until the deadline passes. Every remote surface
	 *  begins with that handshake. It calls `giveUp` between attempts, so a child that exits while starting ends the wait. */
	private async awaitBegin(url: string, giveUp: () => boolean): Promise<boolean> {
		const rpc = new RpcClient({ baseUrl: url, timeoutMs: BEGIN_TIMEOUT_MS, retry: { maxAttempts: 1 } });
		const deadline = Date.now() + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			if (await begins(rpc)) return true;
			if (giveUp()) return false;
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
		}
		return false;
	}

	/** Returns when a run exits or reports that its features finished, or after `seconds`. The child's exit event and that
	 *  report wake the wait, so this step doesn't poll. */
	private async waitRun(run: string, seconds: number, cursor: number) {
		const held = this.startedRun("wait for run", run);
		if (held.ended === null && !executionEnded(held.outcome.actuality)) {
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					held.child.off("exit", done);
					held.waiters = held.waiters.filter((w) => w !== done);
					resolve();
				};
				const timer = setTimeout(done, seconds * 1000);
				held.child.once("exit", done);
				// A standing run doesn't exit, so its report that its features finished also wakes this wait.
				held.waiters.push(done);
			});
		}
		return this.readRun(run, cursor);
	}

	/** Returns a run's output since `cursor`, its status, and the outcome accrued from its events. */
	private readRun(run: string, cursor: number) {
		const held = this.startedRun("read run", run);
		const { actuality, report } = held.outcome;
		const [first] = actuality.failures;
		return actionOKWithProducts({
			run,
			status: runStatus(held),
			exitCode: held.ended,
			...held.tail.since(cursor),
			features: actuality.features.length,
			execution: actuality.status,
			steps: actuality.steps,
			failed: actuality.failures.length,
			...(first === undefined ? {} : { firstFailure: failureLine(first) }),
			summary: runSummary(actuality),
			...(report === undefined ? {} : { report }),
		});
	}

	/** Forks the CLI and waits for the action.begin handshake. startInstance and restartInstance both call it, so a
	 *  restarted instance is launched as it was first launched. */
	private async launch({ dir, config, port, hostId }: TLaunch) {
		const cliEntry = createRequire(import.meta.url).resolve("@haibun/cli");
		// The child inherits this process's environment with its own port, so it can't read the launcher's port from it.
		// This process passes the launcher's origin as LAUNCHED_FROM in HAIBUN_ENV. A launched instance reads it as
		// $LAUNCHED_FROM$ to mount the launcher's store and report to the launcher without naming a port in its source.
		const launcherPort = process.env[INSTANCE_PORT_ENV];
		const passed = [process.env.HAIBUN_ENV, launcherPort ? `${LAUNCHED_FROM}=${localOrigin(Number(launcherPort))}` : ""].filter(Boolean).join(",");
		const env = { ...runEnvironment(process.env, port, false, hostId, perProcessOptionNames(this.steppers)), ...(passed ? { HAIBUN_ENV: passed } : {}) };
		// execArgv: [] runs the built CLI in plain node, without a test runner's loader flags.
		// The child's cwd is its base, since a base's config paths are relative to that base. A launched instance whose
		// stepper paths resolved against the launcher's directory couldn't load its own steppers.
		const child = fork(cliEntry, ["-c", config, dir], { env, cwd: dir, silent: true, execArgv: [] });
		superviseChild(child); // the child ends with this process: a staying session that ends by signal terminates its children
		const stderrTail = new RunTail(STDERR_TAIL_CHARS);
		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[instance:${hostId}] ${data.toString()}`);
			stderrTail.append(data.toString());
		});
		// An instance that doesn't become ready usually logs the cause to stdout rather than stderr. Without that output,
		// a timeout message would leave the caller to start the instance by hand to find the cause. This process keeps
		// the stdout tail without echoing it, since stdout carries the instance's event stream and the message needs only its last lines.
		const saidTail = new RunTail(STDERR_TAIL_CHARS);
		child.stdout?.on("data", (data: Buffer) => saidTail.append(data.toString()));
		this.children.push({ child, label: `${dir} host ${hostId}`, launch: { dir, config, port, hostId } });

		this.holdSignInAt(port, signInOf(dir, dir, env));
		const url = localOrigin(port);
		const rpc = new RpcClient({ baseUrl: url, timeoutMs: 1_500, retry: { maxAttempts: 1 } });
		const deadline = Date.now() + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null) {
				const said = stderrTail.since(0).output;
				return actionNotOK(`instance at ${dir} exited with code ${child.exitCode} before it served. Correct the cause its error output reports${said ? `\n${said}` : ""}`);
			}
			const begun = await begins(rpc);
			if (begun) {
				// Ready means serving: the instance's feature has executed every step that sets it up. Its port responds before
				// then, and a caller that treated that response as ready would race the steps the feature executes after listening.
				if (begun.serving !== true) {
					await new Promise((r) => setTimeout(r, READY_POLL_MS));
					continue;
				}
				// The handshake verifies that the child took the assigned host id. An unchecked wrong hostId would break seqPath and site uniqueness.
				if (begun.hostId !== hostId)
					return actionNotOK(
						`instance at ${url} reports hostId ${begun.hostId} instead of the assigned ${hostId}. Another process may hold that port. Stop that process, or choose another port`,
					);
				if (typeof begun.site !== "string" || begun.site.length === 0)
					return actionNotOK(`instance at ${url} didn't return a site principal in its handshake. Another process may hold that port. Stop that process, or choose another port`);
				return actionOKWithProducts({ url, site: begun.site, hostId });
			}
			await new Promise((r) => setTimeout(r, READY_POLL_MS));
		}
		const lastSaid = stderrTail.since(0).output || saidTail.since(0).output;
		return actionNotOK(`instance at ${dir} didn't serve on ${url} within ${READY_DEADLINE_MS}ms. Correct the cause its output reports${lastSaid ? `\n${lastSaid}` : ""}`);
	}
}
