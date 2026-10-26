/**
 * InstanceStepper supervises sibling haibun processes of two kinds. An instance serves, and a run executes features.
 * `start a haibun instance from {where} on port {port} as host {hostId}` forks the cli.js that an operator runs.
 * The child reads the config directory that a deployment uses, and the waypoint libraries `where` names after it, as a command line does.
 * The child stays after its features end, as HAIBUN_STAY states, and serves once they passed.
 * Readiness is the action.begin handshake. Federation and remote steppers use the same handshake. The child's exit and its
 * events end the wait where it stops first, with the step that failed, so a launch doesn't wait out a deadline.
 * The step's products carry the instance's url, site principal and hostId.
 * The operator assigns hostIds: the feature states the id, and the handshake verifies that the child took it.
 * endFeature terminates the children when the feature closes, and a child the supervisor forks ends with this process.
 *
 * A run is the other kind of child: the same cli.js, forked with a feature filter.
 * startRun doesn't await a run, so the caller can act while it executes.
 * The caller is a person at a terminal or an agent that selects its next step.
 * A run with a host above 0 stays up after its features finish, so a caller can still query what it produced.
 *
 * This process reads a run's events as they arrive. A run writes its events as NDJSON on its output.
 * Each chunk moves the actuality machine whose state a caller reads: the features that ran, the step count, the
 * failures, and whether the child's actuality has ended.
 * This process also keeps the child's process output as a bounded tail that a caller reads from a cursor.
 * That output is the only record of a run that fails before it serves. The bound keeps a long run's output from growing without limit.
 * `SseSubscriber` subscribes to a serving run that this process didn't fork.
 *
 * Runs are held in their own map. endFeature terminates runs under the same condition as instances.
 */
import type { THandshake } from "@haibun/core/lib/transport/domains/rpc-wire.js";
import type { ChildProcess } from "node:child_process";
import path from "path";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { actionNotOK, actionOKWithProducts, basesFrom, perProcessOptionNames } from "@haibun/core/lib/domains/util.js";
import { namesPackage } from "@haibun/core/lib/actuality.js";
import { localOrigin } from "@haibun/core/lib/domains/local-origin.js";
import { instanceSignIns, locatedBase, supervisorPorts } from "./root.js";
import type { TBasicAuthUser } from "@haibun/core/lib/domains/basic-auth.js";
import { readRemoteHost, remoteTools } from "@haibun/core/lib/transport/pipelines/remote-host.js";
import { requestSigner } from "@haibun/core/lib/domains/session-authority.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { OK, ACTUALITY_LEVELS, RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { LEVEL_STATUS } from "@haibun/core/lib/actuality/domains/level-status.js";
import { DEFAULT_HOST_ID } from "@haibun/core/lib/domains/host-id.js";
import { type TRunOutcome, emptyOutcome, firstFailure, readRunOutput } from "./pipelines/run-outcome.js";
import { actualityEnded, transition, type TActuality, type TActualityMove } from "@haibun/core/lib/actuality/machines/actuality.js";
import { writeLevelRecord, type TLevelMoved, type TLevelRecords } from "@haibun/core/lib/actuality/pipelines/move-actuality.js";
import type { TLevelNaming, TStepRecord } from "@haibun/core/lib/actuality/derivations/step-records.js";
import { SEQ_PATH_EDGE, SEQ_PATH_FIELD, actualityFeatureOf, formatRecordName } from "@haibun/core/lib/seq-path.js";
import { actingAs, askedIn } from "@haibun/core/lib/domains/capability-context.js";
import { signInOf, verifiedRun } from "./pipelines/run-conditions.js";
import { INSTANCE_PORT_ENV, KEY_ENV, RUN_DOMAIN, RUN_TAIL_CHARS, RunTail, SUPERVISOR_CAPABILITIES, runDomainDefinitions, runEnvironment } from "./domains/run.js";
import { DOMAIN_FILE_PATH, DOMAIN_NUMBER } from "@haibun/core/lib/domains/domains.js";
import { listOf } from "@haibun/core/lib/domains/lists.js";
import { CountedFields, counted } from "@haibun/core/lib/domains/hypermedia.js";

const READY_POLL_MS = 300;
/** The extension of a config's file, which a run names in place of the directory that holds its config.json. */
const JSON_FILE = ".json";
/** The cursor of a run's output at its start. */
const OUTPUT_START = 0;
const STDERR_TAIL_CHARS = 4_000;
/** The HAIBUN_ENV variable a launched instance reads to address its launcher: `use store at $LAUNCHED_FROM$ …`. */
const LAUNCHED_FROM = "LAUNCHED_FROM";

const instanceStartedSchema = z.object({ url: z.string(), site: z.string(), hostId: z.number() });
/** A supervised run: the child, its output tail, the outcome accrued from its events, its exit code, and the callbacks
 *  waiting for its features to finish. `ended` is null until the child exits. `naming` names the records of the levels of
 *  the child's actuality, `stated` holds what the actuality's record states of how it started, `levels` the records of
 *  its levels, and `writing` the writes of those records in the order of the moves. */
export type TRun = {
	child: ChildProcess;
	tail: RunTail;
	outcome: TRunOutcome;
	ended: number | null;
	waiters: Array<() => void>;
	naming: TLevelNaming;
	stated: TStepRecord;
	levels: TLevelRecords;
	writing: Promise<unknown>;
};

/** The arguments with which an instance was launched. restartInstance launches the same instance again from them. */
/** The directory a child starts in, the config.json it reads and the bases it runs. */
type TBases = { dir: string; config: string; bases: string[] };
type TLaunch = TBases & { port: number; hostId: number };

/** Whether a run is running or ended. */
const runStatus = (held: TRun): string => (held.ended === null ? "running" : "ended");

/** The domain of the instances and runs this process started. */
const DOMAIN_INSTANCES = "haibun-instances";
/** The domain of the products that starting an instance returns. */
const DOMAIN_INSTANCE_STARTED = "instance-started";
/** The instances and runs this process started. It supervises them until they end. */
const InstancesSchema = z.object({
	instances: z
		.array(z.object({ hostId: z.number(), origin: z.string(), label: z.string() }))
		.describe("Each instance this process launched and still supervises: its host id, its origin, and the directory from which it was launched."),
	runs: z.array(z.object({ run: z.string(), status: z.string() })).describe("Each run this process started, and whether it is running or ended."),
	...CountedFields,
});

/** Returns an instance's response to the action.begin handshake, or undefined while the instance doesn't accept the call.
 *  A starting instance refuses the connection or doesn't respond until it listens, so a caller waiting on it calls again. */
async function begins(origin: string): Promise<THandshake | undefined> {
	// A response that fails the handshake schema is rethrown. Any other failure means the instance doesn't accept calls yet.
	return await supervisorPorts.hosts.begin(origin).catch((e: unknown) => {
		if (e instanceof z.ZodError) throw e;
		return undefined;
	});
}

/** Why a launched instance stopped before it served, or undefined while it starts: it exited, a step of its actuality failed,
 *  or its features ended without its handshake stating that it serves. `said` holds its error output. */
function stoppedBeforeServing(dir: string, child: ChildProcess, actuality: TActuality, said: RunTail): string | undefined {
	const { output } = said.since(0);
	const shown = output ? `\n${output}` : "";
	if (child.exitCode !== null) return `instance at ${dir} exited with code ${child.exitCode} before it served. Correct the cause its error output reports${shown}`;
	const failed = firstFailure(actuality);
	if (failed !== undefined) return `instance at ${dir} failed before it served, at ${failed}. Correct that step, then start the instance again`;
	if (actualityEnded(actuality)) return `instance at ${dir} ended its features before it served. Correct the cause its error output reports${shown}`;
	return undefined;
}

/** Why a standing run stopped before it responded to the handshake, or undefined while it starts: it exited, or its features ended. */
const runStopped = (held: TRun): string | undefined =>
	held.ended !== null ? `it exited with code ${held.ended}` : actualityEnded(held.outcome.actuality) ? "its features ended" : undefined;

/** Returns the bases `where` names, comma-separated as a command line names them: the first a config the child reads, or a directory
 *  that holds the config.json it reads, by its path or its package's export, and each after it a waypoint library by its path or its
 *  package, which is found from the config's directory. Each is resolved, so the child reads the bases this process names. Throws with
 *  `doing` as the prefix when the config isn't there. */
function configIn(doing: string, where: string): TBases {
	const [first, ...libraries] = basesFrom(where);
	const named = locatedBase(String(first), process.cwd());
	const config = named.endsWith(JSON_FILE) ? named : path.join(named, "config.json");
	const dir = path.dirname(config);
	if (!supervisorPorts.fs.existsSync(config)) throw new Error(`${doing}: ${config} isn't there. Name a config, or a directory that holds a config.json`);
	return { dir, config, bases: [dir, ...libraries.map((library) => locatedBase(library, namesPackage(library) ? dir : process.cwd()))] };
}

export default class InstanceStepper extends AStepper implements IHasCycles {
	description = "Start and supervise sibling haibun instances (forked cli.js, readiness via action.begin, terminated at endFeature)";

	/** The steppers this process holds. Their declarations name the options a child doesn't inherit. */
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
	/** The key this process gave its last run. */
	private lastKey = 0;

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
				{ selectors: [DOMAIN_INSTANCES], schema: InstancesSchema, list: listOf(InstancesSchema, "instances"), description: "The instances and runs a process started" },
				{ selectors: [DOMAIN_INSTANCE_STARTED], schema: instanceStartedSchema, description: "An instance a process started, with its url, its site principal and its host id" },
				...runDomainDefinitions,
			],
		}),
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return;
			await Promise.all([
				...this.children.map(({ child }) => supervisorPorts.processes.terminate(child)),
				...[...this.runs.values()].map((r) => supervisorPorts.processes.terminate(r.child)),
			]);
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
				"Stop an instance this process launched, and launch it again with the same bases, config, port and host id. The step waits until the instance serves. An instance serves its source as it was when the instance started, so a change to that source takes effect after a restart. The process that restarts an instance is never the instance it restarts.",
			productsDomain: DOMAIN_INSTANCE_STARTED,
			action: async ({ port }: { port: number }) => {
				const held = this.launchedInstance("restart instance", port);
				await supervisorPorts.processes.terminate(held.child);
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
				"Run features from a directory in a child of this process. The filter selects the features. The step doesn't await the child, so the caller can watch it while it executes (see `read the haibun run`). The child starts in the `from` directory, because a config's relative stepper paths and a base's served files resolve against the directory in which a run starts. That directory is usually the base itself. For a base whose runs start in its parent directory, it is that parent. The child's web server takes the given port, so two runs can execute at once without both taking a default port. Port zero leaves a run on the ports its features declare. With host zero, a run ends when its features finish. With a host above zero, a run stays up and takes that host id, and this process registers its steps. A caller then calls one of those steps as `on host {id}, <step>`, without a second calling mechanism. A run that stays up needs a port of its own, since a caller can't reach a run that doesn't have an address.",
			productsDomain: RUN_DOMAIN.started,
			action: async ({ where, filter, from, port, run, hostId }: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				const standing = hostId > 0;
				if (standing && port <= 0) return actionNotOK("start run: a run with a host above 0 stays up and needs a port above 0. Pass a port, or use host 0");
				const started = await this.startRun({ where, filter, from, port, run, standing, hostId: standing ? hostId : DEFAULT_HOST_ID });
				if (!started.ok || !standing) return started;
				// Callers call a standing run's steps. A standing run whose steps don't register fails at start rather than at a
				// later call. The child is terminated so it doesn't hold a port that a caller can't reach.
				const held = this.startedRun("start run", run);
				const unregistered = await this.registerRunHost(held, port);
				if (unregistered === undefined) return started;
				const said = held.tail.since(0).output.slice(-STDERR_TAIL_CHARS);
				await supervisorPorts.processes.terminate(held.child);
				this.runs.delete(run);
				return actionNotOK(
					`start run: "${run}" didn't complete the handshake as host ${hostId} on port ${port}: ${unregistered}. This process stopped it. Correct the cause its output reports${said ? `\n${said}` : ""}`,
				);
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
						...counted(this.children.length),
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
			action: ({ run, cursor }: { run: string; cursor: number }) => this.readRun(run, cursor),
		},
		waitRun: {
			gwta: `wait for the haibun run {run: ${RUN_DOMAIN.name}} to end within {seconds: number} seconds`,
			precludes: ["WebPlaywright.waitFor"],
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Wait until a run exits or reports that its features finished, or until the timeout passes, then return. This process receives the child's exit event and its report that its features finished, so the step returns as soon as either arrives and the caller doesn't poll. The products have the same shape as readRun's. At the timeout the step returns the same products with a status of running. A timeout isn't a failure. The caller then waits again or stops it with `stop the haibun run`.",
			productsDomain: RUN_DOMAIN.read,
			// A line doesn't state a cursor, so a wait it states returns the output of a run from its start.
			action: ({ run, seconds, cursor }: { run: string; seconds: number; cursor?: number }) => this.waitRun(run, seconds, cursor === undefined ? OUTPUT_START : cursor),
		},
		stopRun: {
			gwta: `stop the haibun run {run: ${RUN_DOMAIN.name}}`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			description:
				"End a run this process started, whether or not it has finished. A run left standing holds its port until it is stopped. The records of its levels that hadn't ended state that they stopped.",
			productsDomain: RUN_DOMAIN.stopped,
			action: async ({ run }: { run: string }) => {
				const held = this.startedRun("stop run", run);
				await supervisorPorts.processes.terminate(held.child);
				await this.stopLevels(held);
				await held.writing;
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
		hostId: number;
	}) {
		if (this.runs.has(run)) return actionNotOK(`start run: this process already holds a run named "${run}". Read it, stop it, or choose another name`);
		const { dir, config, bases } = configIn("start run", where);
		// A run given a port in use fails at boot, and its own output holds the EADDRINUSE error. This refusal describes
		// the process on the port and the remedy instead.
		if (port > 0) {
			const answering = await supervisorPorts.processes.occupant(port);
			if (answering) return actionNotOK(`start run: port ${port} is already in use: ${answering}. Stop the process on that port, or choose another port`);
		}
		// A port above zero makes a run addressable. A standing run also gets STAY, so its endpoint stays up after its
		// features finish. Port 0 leaves a run on the ports its features declare. A feature that asserts a default port
		// needs port 0. A run that isn't standing ends when its features end.
		// A run's key names the child's actuality and each of its actuality features, so this process writes the records of
		// the actuality's levels under the names the child's own records take. A key is the time a run started, later than
		// every key this process gave before.
		this.lastKey = Math.max(this.getWorld().clock.now(), this.lastKey + 1);
		const naming = { key: String(this.lastKey), hostId };
		const env = { ...runEnvironment(process.env, port, standing, hostId, perProcessOptionNames(this.steppers)), [KEY_ENV]: naming.key };
		// A run whose features have a recorded outcome against their present dependencies isn't started, since it would
		// repeat that outcome. The child records each outcome with the conditions it ran under. verifiedRun computes
		// those conditions from the environment the child would receive, and looks up an outcome under them.
		// A run's starting directory determines how its relative paths resolve, so the caller passes it. An empty `from`
		// uses this process's directory.
		const cwd = from ? locatedBase(from, process.cwd()) : process.cwd();
		if (!supervisorPorts.fs.existsSync(cwd)) return actionNotOK(`start run: the starting directory ${cwd} doesn't exist. Pass an existing starting directory`);
		const ran = verifiedRun(supervisorPorts, config, bases, filter, cwd, env);
		if (ran)
			return actionNotOK(
				`start run: ${filter || "every feature"} in ${dir} ${ran} against its present dependencies. A new run would repeat that outcome. Change a dependency to run it again, or note that the group has changed.`,
			);
		if (port > 0) this.holdSignInAt(port, signInOf(supervisorPorts, bases, cwd, env));
		// A standing run can outlive its feature, but not this process.
		const child = supervisorPorts.processes.forkCli(["-c", config, bases.join(","), filter], { cwd, env });
		const performedBy = actingAs();
		const ask = askedIn();
		const stated = {
			...(performedBy === undefined ? {} : { [SEQ_PATH_EDGE.performedBy]: performedBy }),
			...(ask === undefined ? {} : { [SEQ_PATH_EDGE.askedIn]: ask }),
			...(standing ? { [SEQ_PATH_FIELD.ranOn]: localOrigin(port) } : {}),
		};
		const held: TRun = {
			child,
			tail: new RunTail(RUN_TAIL_CHARS),
			outcome: emptyOutcome(),
			ended: null,
			waiters: [],
			naming,
			stated,
			levels: new Map(),
			writing: Promise.resolve(),
		};
		const take = (data: Buffer): void => this.take(held, data.toString());
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		child.once("exit", (code) => {
			held.ended = typeof code === "number" ? code : -1;
		});
		this.runs.set(run, held);
		return actionOKWithProducts({ run, where: dir, filter, record: formatRecordName({ actuality: actualityFeatureOf({ key: naming.key, featureNum: 0 }), path: [] }) });
	}

	/** Reads a chunk of a run's output: it keeps the chunk in its tail, moves its machine, writes the records of the levels
	 *  the chunk moved, and wakes its waiters where the chunk ended its actuality, whether or not it keeps serving. */
	protected take(held: TRun, text: string): void {
		held.tail.append(text);
		const wasFinished = actualityEnded(held.outcome.actuality);
		for (const moved of readRunOutput(held.outcome, text)) this.writeLevel(held, moved);
		if (!wasFinished && actualityEnded(held.outcome.actuality)) for (const wake of held.waiters.splice(0)) wake();
	}

	/** Writes the record of the actuality level that a run's move started or ended into this process's store, after the
	 *  records of the moves before it. A read of a run awaits the writes, so a write that fails fails the read with its cause. */
	private writeLevel(held: TRun, moved: TLevelMoved): void {
		const stated = moved.move.type === "actuality" ? held.stated : undefined;
		held.writing = held.writing.then(() => writeLevelRecord(this.getWorld().shared.getStore(), held.levels, moved, held.naming, stated));
	}

	/** Ends as stopped each level of a run's actuality that hasn't ended, innermost first, so the records of a stopped
	 *  run's actuality state that it stopped. It reads the levels once the records of a run's moves are written. */
	private async stopLevels(held: TRun): Promise<void> {
		await held.writing;
		const timestamp = this.getWorld().clock.now();
		for (const [id, record] of [...held.levels].reverse().filter(([, level]) => level[SEQ_PATH_FIELD.actionStatus] === RECORDED_STATUS.running)) {
			const move: TActualityMove = { type: z.enum(ACTUALITY_LEVELS).parse(record[SEQ_PATH_FIELD.actualityLevel]), stage: "end", id, status: LEVEL_STATUS.stopped };
			held.outcome.actuality = transition(held.outcome.actuality, move);
			this.writeLevel(held, { move, after: held.outcome.actuality, timestamp });
		}
	}

	/**
	 * Registers a standing run's steps in this process under its host id, once it completes the handshake. Returns why the
	 * steps weren't registered where the child exits, or its features end, before it responds.
	 *
	 * A standing run is another host. readRemoteHost reads the host id through the same handshake and fetches the host's
	 * step descriptors, and their proxy tools are injected into this registry under `{hostId}:{method}`. A caller then calls one of
	 * its steps as `on host {hostId}, <step>`, and it is dispatched and gated as a local step is. A run that doesn't serve
	 * doesn't register steps, since it doesn't respond to a call.
	 */
	private async registerRunHost(held: TRun, port: number): Promise<string | undefined> {
		const url = localOrigin(port);
		const begun = await this.awaitBegin(url, false, () => runStopped(held));
		if ("stopped" in begun) return begun.stopped;
		await this.registerHost(url);
		return undefined;
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
		const rpc = supervisorPorts.hosts.steps(url, requestSigner(world.runtime));
		runRegistry(world).inject(remoteTools(rpc, url, await readRemoteHost(rpc, url)));
	}

	/** Waits until a child responds to the action.begin handshake, and returns its response. Every remote surface begins with
	 *  that handshake. Where `serving` is true, a response is ready only once it states that the child serves. `stopped` reads
	 *  the child's exit and its events, and returns why it stopped before it responded. The wait returns that reason where an
	 *  attempt made after the child stopped doesn't respond as ready. */
	private async awaitBegin(url: string, serving: boolean, stopped: () => string | undefined): Promise<THandshake | { stopped: string }> {
		const { clock } = this.getWorld();
		for (;;) {
			const reason = stopped();
			const begun = await begins(url);
			if (begun !== undefined && (begun.serving || !serving)) return begun;
			if (reason !== undefined) return { stopped: reason };
			await clock.wait(READY_POLL_MS);
		}
	}

	/** Returns when a run exits or reports that its features finished, or after `seconds`. The child's exit event and that
	 *  report wake the wait, so this step doesn't poll. */
	private async waitRun(run: string, seconds: number, cursor: number) {
		const held = this.startedRun("wait for run", run);
		if (held.ended === null && !actualityEnded(held.outcome.actuality)) {
			await new Promise<void>((resolve) => {
				const done = () => {
					cancel();
					held.child.off("exit", done);
					held.waiters = held.waiters.filter((w) => w !== done);
					resolve();
				};
				const cancel = this.getWorld().clock.after(seconds * 1000, done, true);
				held.child.once("exit", done);
				// A standing run doesn't exit, so its report that its features finished also wakes this wait.
				held.waiters.push(done);
			});
		}
		return this.readRun(run, cursor);
	}

	/** Returns a run's output since `cursor`, its status, and the outcome accrued from its events, once the records of its
	 *  levels are written. */
	private async readRun(run: string, cursor: number) {
		const held = this.startedRun("read run", run);
		await held.writing;
		const { actuality, report } = held.outcome;
		return actionOKWithProducts({
			run,
			status: runStatus(held),
			exitCode: held.ended,
			...held.tail.since(cursor),
			features: actuality.features.length,
			actuality: actuality.status,
			steps: actuality.steps,
			failures: actuality.failures,
			...(report === undefined ? {} : { report }),
		});
	}

	/** Forks the CLI and waits for the action.begin handshake. startInstance and restartInstance both call it, so a
	 *  restarted instance is launched as it was first launched. */
	private async launch({ dir, config, bases, port, hostId }: TLaunch) {
		// The child inherits this process's environment with its own port, so it can't read the launcher's port from it.
		// This process passes the launcher's origin as LAUNCHED_FROM in HAIBUN_ENV. A launched instance reads it as
		// $LAUNCHED_FROM$ to mount the launcher's store and report to the launcher without naming a port in its source.
		const launcherPort = process.env[INSTANCE_PORT_ENV];
		const passed = [process.env.HAIBUN_ENV, launcherPort ? `${LAUNCHED_FROM}=${localOrigin(Number(launcherPort))}` : ""].filter(Boolean).join(",");
		// An instance serves, so it stays after its features end, as a standing run does.
		const env = { ...runEnvironment(process.env, port, true, hostId, perProcessOptionNames(this.steppers)), ...(passed ? { HAIBUN_ENV: passed } : {}) };
		// The child's cwd is its base, since a base's config paths are relative to that base. A launched instance whose
		// stepper paths resolved against the launcher's directory couldn't load its own steppers. The child ends with this
		// process: a staying session that ends by signal terminates its children.
		const child = supervisorPorts.processes.forkCli(["-c", config, bases.join(",")], { cwd: dir, env });
		const stderrTail = new RunTail(STDERR_TAIL_CHARS);
		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[instance:${hostId}] ${data.toString()}`);
			stderrTail.append(data.toString());
		});
		// The child writes its events on its output, as a run does, and its actuality holds the step that fails before it serves.
		// This process doesn't echo that output, since it carries the instance's event stream.
		const outcome = emptyOutcome();
		child.stdout?.on("data", (data: Buffer) => void readRunOutput(outcome, data.toString()));
		this.children.push({ child, label: `${dir} host ${hostId}`, launch: { dir, config, bases, port, hostId } });

		this.holdSignInAt(port, signInOf(supervisorPorts, bases, dir, env));
		const url = localOrigin(port);
		// Ready means serving: the instance's feature has executed every step that sets it up. Its port responds before then, and
		// a caller that treated that response as ready would race the steps the feature executes after listening.
		const begun = await this.awaitBegin(url, true, () => stoppedBeforeServing(dir, child, outcome.actuality, stderrTail));
		if ("stopped" in begun) return actionNotOK(begun.stopped);
		// The handshake verifies that the child took the assigned host id. An unchecked wrong hostId would break seqPath and site uniqueness.
		if (begun.hostId !== hostId)
			return actionNotOK(
				`instance at ${url} reports hostId ${begun.hostId} instead of the assigned ${hostId}. Another process may hold that port. Stop that process, or choose another port`,
			);
		return actionOKWithProducts({ url, site: begun.site, hostId });
	}
}
