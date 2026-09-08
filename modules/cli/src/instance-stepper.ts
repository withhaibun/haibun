/**
 * InstanceStepper supervises sibling haibun processes: instances that SERVE, and runs that EXECUTE and exit. `start a haibun instance from {where} on port
 * {port} as host {hostId}` forks the same cli.js an operator runs, against the config directory a real
 * deployment would use; the child serves because ITS feature ends with `this feature runs as a service
 * until stopped`. Readiness is the action.begin handshake (the same one federation and remote steppers
 * use), so the step's products carry the instance's url, site principal, and hostId. Assigning hostIds
 * stays an operator concern: the feature states the id, and the handshake verifies the child took it.
 * Children are terminated at endFeature; a launched instance never outlives the feature that owns it.
 *
 * A RUN is the other kind of child: the same cli.js, given a feature filter. It is started rather than awaited so the
 * caller, a person at a terminal or an agent deciding what to do next, can act while it happens, and it is left
 * standing when its features finish so what it produced can still be asked about.
 *
 * A run's own events are read here as it produces them: its output arrives as NDJSON, and each chunk accrues into the
 * outcome a caller reads — which features ran, how many steps, what failed first, and whether the run says it is
 * finished. Beside that outcome the child's PROCESS output is kept as a bounded tail read from a cursor, since a run
 * that fails before it serves says nothing else, and a long run cannot be allowed to grow without limit.
 * `SseSubscriber` subscribes to a serving run this process did not fork.
 *
 * Runs are supervised by the same list and torn down by the same rule as instances.
 */
import { fork, type ChildProcess } from "child_process";
import { createRequire } from "module";
import { superviseChild, terminate } from "@haibun/core/lib/owned-children.js";
import { describePortOccupant } from "@haibun/core/lib/port-occupant.js";
import { existsSync, readFileSync } from "fs";
import { parseEnv } from "node:util";
import path from "path";
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TEndFeature } from "@haibun/core/lib/astepper.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { actionNotOK, actionOKWithProducts, perProcessOptionNames } from "@haibun/core/lib/util/index.js";
import { RpcClient } from "@haibun/core/lib/rpc-client.js";
import { RemoteStepperProxy } from "@haibun/core/lib/remote-stepper-proxy.js";
import type { StepRegistry } from "@haibun/core/lib/step-registry.js";
import { BASE_PREFIX, NDJSON, STAY, STAY_ALWAYS } from "@haibun/core/schema/protocol.js";
import { HAIBUN_HOST_ID_ENV } from "@haibun/core/lib/host-id.js";
import { type TRunOutcome, emptyOutcome, accrueRunOutcome } from "./run-outcome.js";
import { getConfigFromBase, processBaseEnvToOptionsAndErrors } from "./lib.js";
import { outcomeAgainst, verificationOf, type TOutcome } from "./verified.js";

/** The environment names of the two things a process holds for itself, which core owns: whether it stays up, and
 *  which host it is. Everything else per-process is declared by the option that owns it (see `perProcessOptionNames`). */
const STAY_ENV = `${BASE_PREFIX}${STAY}`;
const NDJSON_ENV = `${BASE_PREFIX}${NDJSON}`;

/**
 * The environment name an instance takes its serving port from. It is the web server's own option, named here because
 * a launcher assigns a port to an instance whose steppers it does not hold: what a launcher promised its caller is the
 * port the instance serves on, so the assignment cannot depend on which steppers the launcher happens to register.
 */
const INSTANCE_PORT_ENV = "HAIBUN_O_WEBSERVERSTEPPER_PORT";

const READY_DEADLINE_MS = 30_000;
/** How long one handshake attempt is given before the next: a starting child answers late, not slowly. */
const BEGIN_TIMEOUT_MS = 1_500;
const READY_POLL_MS = 300;
const STDERR_TAIL_CHARS = 4_000;
/** How much of a run's output is kept for reading back. Older output is dropped, and a read that starts before what
 *  is kept says so, rather than silently returning a gap as if it were the whole story. */
const RUN_TAIL_CHARS = 200_000;

/** The run variable a launched instance reads to address its launcher: `use store at $LAUNCHED_FROM$ …`. */
export const LAUNCHED_FROM = "LAUNCHED_FROM";

/**
 * The capabilities a caller must hold to supervise a process, as ZCAP-LD `allowedAction` values.
 *
 * Each names one action, and each is declared on the step that carries that action out, never on a step that calls
 * another. A step that calls another declares the same action it will call through to, so an action a caller cannot
 * carry out directly is not available to it indirectly. Grants are per action, so "may start runs" and "may stop
 * runs" are separate grants, and either can be revoked while the other stands.
 *
 * The check itself is in `dispatchStep`, identically for a feature line, an RPC call, an MCP tool call and a model's
 * tool call; the caller's capability comes from the token the step runs under (`with token {t}, …`), so no step here
 * reads a token.
 */
export const SUPERVISOR_CAPABILITIES = {
	/** Start a serving instance from a directory of features. */
	launch: "Instance:launch",
	/** Start a run of features, which carries out what those features say on this machine. */
	run: "Instance:run",
	/** Read what a run has said, which is its output verbatim. */
	read: "Instance:read",
	/** End a run or an instance this process started. */
	stop: "Instance:stop",
} as const;

const instanceStartedSchema = z.object({ url: z.string(), site: z.string(), hostId: z.number() });
/** What starting and reading a run answer with. Exported so a caller parses the products rather than asserting a shape. */
export const runStartedSchema = z.object({ run: z.string(), where: z.string(), filter: z.string() });
export const runReadSchema = z.object({
	run: z.string(),
	status: z.string(),
	exitCode: z.number().nullable(),
	cursor: z.number(),
	output: z.string(),
	dropped: z.number(),
	// What the run has reported about itself so far, counted from every chunk it wrote rather than from the tail that
	// is still kept: a run that says more than the tail holds is still counted in full.
	features: z.number(),
	steps: z.number(),
	/** Whether the run's features are over. A run left standing reports this and then keeps serving, so a caller
	 *  waiting on it waits for this rather than for an exit that will not come. */
	finished: z.boolean(),
	failed: z.number(),
	firstFailure: z.string(),
	summary: z.string(),
	report: z.string(),
});

/**
 * A run's output as it is kept: a bounded tail, read from a cursor, with what fell out of the tail counted rather
 * than passed off as nothing. A reader that asks from further back than what is kept is told how much it missed.
 */
export class RunTail {
	/** What is kept, as it arrived. Joining on a read rather than on every chunk keeps a busy run from copying the
	 *  whole tail per line it prints. */
	private chunks: string[] = [];
	private keptChars = 0;
	private droppedChars = 0;
	constructor(private readonly keep: number = RUN_TAIL_CHARS) {}

	append(text: string): void {
		if (text === "") return;
		// A chunk longer than the whole tail is the one case that has to be cut rather than dropped whole.
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

	/** What was said after `cursor`, where to read from next, and how much of what was asked for is gone. */
	since(cursor: number): { output: string; cursor: number; dropped: number } {
		const from = Math.max(0, cursor - this.droppedChars);
		return { output: this.chunks.join("").slice(from), cursor: this.droppedChars + this.keptChars, dropped: Math.max(0, this.droppedChars - cursor) };
	}
}

/**
 * The environment a run is started with. The port is where the run's own web server listens, so two runs can go at
 * once; standing is whether it stays up after its features finish. They are separate decisions: a run can be moved
 * off a busy port without being left holding it. Both are set here rather than inherited, since a supervisor that
 * serves, or that stays up itself, would otherwise put its run on its own port and keep it running for ever.
 */
export function runEnvironment(inherited: NodeJS.ProcessEnv, port: number, standing: boolean, hostId?: number, perProcess: string[] = []): NodeJS.ProcessEnv {
	const env = { ...inherited };
	// What one process holds, a process it starts does not inherit: each option says so itself.
	for (const name of perProcess) delete env[name];
	delete env[STAY_ENV];
	delete env[HAIBUN_HOST_ID_ENV];
	if (port > 0) {
		for (const name of perProcess.filter((n) => n.endsWith("_PORT"))) env[name] = String(port);
		env[INSTANCE_PORT_ENV] = String(port);
	}
	if (standing) env[STAY_ENV] = STAY_ALWAYS;
	// A run that stays is a host of its own: it takes an id, so its seqPaths say whose work they are and its steps
	// register under it here.
	if (hostId !== undefined) env[HAIBUN_HOST_ID_ENV] = String(hostId);
	// The child is read by this process, not watched by a person, so it reports its events rather than only its
	// formatted log: what failed, where, and how the whole run ended are on that stream and nowhere else.
	env[NDJSON_ENV] = "true";
	return env;
}

/** The environment a run started in a directory has: what it was given, and what the directory's own .env file adds
 *  where the run has nothing of that name already, which is how a run reads that file itself. */
function environmentIn(cwd: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const dotenv = path.join(cwd, ".env");
	if (!existsSync(dotenv)) return env;
	return { ...parseEnv(readFileSync(dotenv, "utf-8")), ...env };
}

/** How the features a run would carry out last ran against their present state under the conditions the run would be
 *  given, computed as the run would compute them: from the directory it runs in, with the environment it reads there.
 *  Undefined where no run has, or where the state cannot be read, in which case the run runs. */
export function verifiedRun(config: string, dir: string, filter: string, cwd: string, env: NodeJS.ProcessEnv): TOutcome | undefined {
	const specl = getConfigFromBase([dir]);
	if (!specl) return undefined;
	const { options, moduleOptions } = processBaseEnvToOptionsAndErrors(environmentIn(cwd, env));
	const v = verificationOf({ configPath: config, specl, bases: [dir], cwd, filter: filter ? filter.split(",") : [], options, moduleOptions });
	return v === undefined ? undefined : outcomeAgainst(v)?.outcome;
}

/** A supervised run: the child, what it was asked to run, and its output so far. `ended` is null while it runs. */
type TRun = { child: ChildProcess; tail: RunTail; outcome: TRunOutcome; ended: number | null; waiters: Array<() => void> };

/** What a launched instance was launched from, so the same instance can be launched again after it is stopped. */
type TLaunch = { dir: string; config: string; port: number; hostId: number };

export default class InstanceStepper extends AStepper implements IHasCycles {
	description = "Start and supervise sibling haibun instances (forked cli.js, readiness via action.begin, terminated at endFeature)";

	/** The steppers this run was set up with: what a child must not inherit is read from their own declarations. */
	private steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	private children: Array<{ child: ChildProcess; label: string; launch: TLaunch }> = [];
	/** Visible to a subclass so a test can hold a run without a process behind it; nothing outside reaches it. */
	protected runs = new Map<string, TRun>();
	/** The host id a standing run took, so its steps are addressable as that host's. */

	cycles: IStepperCycles = {
		endFeature: async (endFeature?: TEndFeature) => {
			if (!endFeature?.shouldClose) return;
			await Promise.all([...this.children.map(({ child }) => terminate(child)), ...[...this.runs.values()].map((r) => terminate(r.child))]);
			this.children = [];
			this.runs.clear();
		},
	};

	steps = {
		startInstance: {
			gwta: `start a haibun instance from {where} on port {port: number} as host {hostId: number}`,
			capability: SUPERVISOR_CAPABILITIES.launch,
			productsSchema: instanceStartedSchema,
			action: async ({ where, port, hostId }: { where: string; port: number; hostId: number }) => {
				const dir = path.resolve(String(where));
				const config = path.join(dir, "config.json");
				if (!existsSync(config)) return actionNotOK(`start instance: no config.json in ${dir}`);
				return await this.launch({ dir, config, port, hostId });
			},
		},
		restartInstance: {
			gwta: `restart the haibun instance on port {port: number}`,
			capability: SUPERVISOR_CAPABILITIES.launch,
			description:
				"Stop an instance this run launched and launch it again from what it was launched from, waiting for it to answer. What an instance serves comes from its source, so a change to that source takes effect only once it runs again. The run that restarts an instance is never the instance being restarted.",
			productsSchema: instanceStartedSchema,
			action: async ({ port }: { port: number }) => {
				const held = this.children.find((c) => c.launch.port === port);
				if (!held) return actionNotOK(`restart instance: this run launched no instance on port ${port}`);
				await terminate(held.child);
				this.children = this.children.filter((c) => c !== held);
				return await this.launch(held.launch);
			},
		},
		startRun: {
			gwta: `start a haibun run of {where} matching {filter} from {from} on port {port: number} as run {run} host {hostId: number}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description:
				"Run features from a directory, filtered to the ones named, in a child of this process, started rather than awaited, so the caller watches it while it happens (see `read the haibun run`). It runs FROM the directory given, because a config's relative stepper paths and a base's served files are read from where a run is started: for most bases that is the base itself, and for a base run from its parent it is that parent. The port is the one its own web server takes, so two runs can go at once without meeting on a default; port zero leaves it to whatever ports its features declare. Host zero is a run that ends when its features do; a host above zero is a run that stays, takes that id, and has its steps registered here, so asking it something is `on host {id}, <step>` rather than a second way of calling. A run that stays needs a port of its own, since a run nobody can address is a run nobody can ask.",
			productsSchema: runStartedSchema,
			action: async ({ where, filter, from, port, run, hostId }: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				const standing = hostId > 0;
				if (standing && port <= 0) return actionNotOK("start run: a run that stays needs a port of its own, since a run nobody can address is a run nobody can ask");
				const started = await this.startRun({ where, filter, from, port, run, standing, hostId: standing ? hostId : undefined });
				if (!started.ok || !standing) return started;
				// A standing run exists to be asked, so a run whose steps never registered is an error now, not a
				// surprise later. The child is ended rather than left holding a port nothing can reach.
				const registered = await this.registerRunHost(run, port, hostId);
				if (!registered) {
					const held = this.runs.get(run);
					const said = held ? held.tail.since(0).output.slice(-STDERR_TAIL_CHARS) : "";
					if (held) await terminate(held.child);
					this.runs.delete(run);
					return actionNotOK(`start run: "${run}" was to stand as host ${hostId} but never served on port ${port}${said ? `\n${said}` : ""}`);
				}
				return started;
			},
		},
		readRun: {
			gwta: `read the haibun run {run} since {cursor: number}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			// The run's output is what the caller asked for, not something to write again: the event carries how much
			// was read, and the caller keeps the text.
			retainProducts: (products: Record<string, unknown>) => ({ ...products, output: `${String(products.output ?? "").length} chars` }),
			description:
				"The run's own process output since a point in it, and whether it is still running. This is the boot-and-crash channel, which is what exists when a run fails before it serves; a serving run's progress is its event stream, which carries seqPaths and outcomes. The cursor returned is where to read from next, so the same output is never read twice.",
			productsSchema: runReadSchema,
			action: ({ run, cursor }: { run: string; cursor: number }) => Promise.resolve(this.readRun(run, cursor)),
		},
		waitRun: {
			gwta: `wait for the haibun run {run} to end within {seconds: number} seconds`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Answer when the run ends, rather than when asked again. This process holds the child, so it is told the moment it exits; a caller asking repeatedly would learn the same thing later and at the cost of a dispatch each time. The answer is a read: what the run said since the cursor given, and what it reported about itself. Reaching the limit answers with the run still running, which is not an error, so the caller decides what to do about it.",
			productsSchema: runReadSchema,
			action: ({ run, seconds, cursor }: { run: string; seconds: number; cursor: number }) => this.waitRun(run, seconds, cursor),
		},
		stopRun: {
			gwta: `stop the haibun run {run}`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			description: "End a run this process started, whether or not it has finished. A run left standing holds its port until it is stopped.",
			action: async ({ run }: { run: string }) => {
				const held = this.runs.get(run);
				if (!held) return actionNotOK(`stop run: this process started no run "${run}"`);
				await terminate(held.child);
				this.runs.delete(run);
				return actionOKWithProducts({ run });
			},
		},
	};

	/** Fork the CLI against a feature filter. The child is NOT awaited: it is supervised, and read through readRun. */
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
		if (this.runs.has(run)) return actionNotOK(`start run: "${run}" is already running; read it, or stop it first`);
		const dir = path.resolve(String(where));
		const config = path.join(dir, "config.json");
		if (!existsSync(config)) return actionNotOK(`start run: no config.json in ${dir}`);
		// A run given a held port would die at boot with EADDRINUSE deep in its own output. Refusing here instead names
		// what is answering and the recourse, so the operator is told the situation rather than left to excavate it.
		if (port > 0) {
			const answering = await describePortOccupant(port);
			if (answering) return actionNotOK(`start run: port ${port} is already answering — ${answering}; stop what answers there, or start this run on another port`);
		}
		const cliEntry = createRequire(import.meta.url).resolve("@haibun/cli");
		// A pinned port is what makes a run addressable, so it is also what leaves the run standing after its features
		// finish: STAY holds the endpoint up to be asked about. Port 0 is a run that answers with its exit code and
		// nothing else; it keeps whatever port its own features declare, which features that assert a default need,
		// and it ends when they end.
		const env = runEnvironment(process.env, port, standing, hostId, perProcessOptionNames(this.steppers));
		// A run that would answer what an earlier run answered is not started. The child records what it passed
		// against under the conditions it is run with, so those same conditions, computed from the environment it
		// would be given, are what a pass is looked for under.
		// Where a run is started from decides what its relative paths mean, so the caller says it rather than inheriting
		// this process's directory by accident.
		const cwd = from ? path.resolve(from) : process.cwd();
		if (!existsSync(cwd)) return actionNotOK(`start run: no directory ${cwd} to run from`);
		const ran = verifiedRun(config, dir, filter, cwd, env);
		if (ran) return actionNotOK(`start run: ${filter || "every feature"} in ${dir} ${ran}, and no dependency has changed since then, so this run would answer what that run answered. Change a dependency to run it again, or note that the group has changed.`);
		const child = fork(cliEntry, ["-c", config, dir, filter], { cwd, env, silent: true, execArgv: [] });
		superviseChild(child); // a standing run may outlive its FEATURE, never its owner process
		const held: TRun = { child, tail: new RunTail(), outcome: emptyOutcome(), ended: null, waiters: [] };
		const take = (data: Buffer): void => {
			const text = data.toString();
			held.tail.append(text);
			const wasFinished = held.outcome.finished;
			accrueRunOutcome(held.outcome, text);
			// A run that says its features are over is done, whether or not it goes on serving.
			if (!wasFinished && held.outcome.finished) for (const wake of held.waiters.splice(0)) wake();
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
	 * Register a standing run's own steps here, under its host id, once it answers.
	 *
	 * A run that stays is another host, and haibun already reaches another host's steps: the proxy discovers the id
	 * through the same handshake, fetches that host's step descriptors, and injects them into this registry under
	 * `{hostId}:{method}`. Asking the run something is then `on host {hostId}, <step>`, dispatched and gated exactly
	 * as a local step is. A run that never serves registers nothing, which is what a run with nothing to answer is.
	 */
	private async registerRunHost(run: string, port: number, hostId: number): Promise<boolean> {
		const url = `http://localhost:${port}`;
		const answered = await this.awaitBegin(url, () => this.runs.get(run)?.ended !== null);
		if (!answered) return false;
		const world = this.getWorld();
		const registry = world.runtime.stepRegistry as StepRegistry | undefined;
		if (!registry) throw new Error(`start run: no step registry on this run's world to register host ${hostId} into`);
		const proxy = new RemoteStepperProxy(url);
		await proxy.setWorld(world, []);
		proxy.injectInto(registry);
		return true;
	}

	/** Wait until a child answers the handshake every remote surface begins with, or until it is over. `giveUp` is asked
	 *  between attempts, so a child that dies while starting is not waited out. */
	private async awaitBegin(url: string, giveUp: () => boolean): Promise<boolean> {
		const rpc = new RpcClient({ baseUrl: url, timeoutMs: BEGIN_TIMEOUT_MS, retry: { maxAttempts: 1 } });
		const deadline = Date.now() + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			const said = await rpc.call<{ hostId?: number }>("action.begin", {}, []);
			if (!("error" in said)) return true;
			if (giveUp()) return false;
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
		}
		return false;
	}

	/** Answer when the run ends, or when the caller's patience does. The child's own exit is the signal; nothing polls. */
	private async waitRun(run: string, seconds: number, cursor: number) {
		const held = this.runs.get(run);
		if (!held) return actionNotOK(`wait for run: this process started no run "${run}"`);
		if (held.ended === null && !held.outcome.finished) {
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					held.child.off("exit", done);
					held.waiters = held.waiters.filter((w) => w !== done);
					resolve();
				};
				const timer = setTimeout(done, seconds * 1000);
				held.child.once("exit", done);
				// A standing run never exits, so it is also woken by the run saying its features are over.
				held.waiters.push(done);
			});
		}
		return this.readRun(run, cursor);
	}

	/** What a run has said since `cursor`, and whether it is still going. */
	private readRun(run: string, cursor: number) {
		const held = this.runs.get(run);
		if (!held) return actionNotOK(`read run: this process started no run "${run}"`);
		const [first] = held.outcome.failures;
		return actionOKWithProducts({
			run,
			status: held.ended === null ? "running" : "ended",
			exitCode: held.ended,
			...held.tail.since(cursor),
			features: held.outcome.features.size,
			finished: held.outcome.finished,
			steps: held.outcome.steps,
			failed: held.outcome.failures.length,
			firstFailure: first ? `${first.seqPath}: ${first.step}${first.message ? ` (${first.message})` : ""}` : "",
			summary: held.outcome.summary,
			report: held.outcome.report,
		});
	}

	/** Fork the CLI and wait for the action.begin handshake. One path, so a restarted instance is launched exactly as it
	 *  was first launched. */
	private async launch({ dir, config, port, hostId }: TLaunch) {
		const cliEntry = createRequire(import.meta.url).resolve("@haibun/cli");
		// The child inherits this process's environment with its OWN port, so the launcher's port is not readable from
		// it. LAUNCHED_FROM is passed as a run variable ($LAUNCHED_FROM$), which is how a launched instance addresses
		// the run that started it, mounting its store and reporting to it, without naming a port in its own source.
		const launcherPort = process.env[INSTANCE_PORT_ENV];
		const passed = [process.env.HAIBUN_ENV, launcherPort ? `${LAUNCHED_FROM}=http://localhost:${launcherPort}` : ""].filter(Boolean).join(",");
		const env = { ...runEnvironment(process.env, port, false, hostId, perProcessOptionNames(this.steppers)), ...(passed ? { HAIBUN_ENV: passed } : {}) };
		// execArgv: [] keeps the child plain node running the built CLI; it must not inherit a test runner's loader flags.
		// The child runs in the base it was started from, since what a base's config says is relative to that base: a
		// launched instance whose steppers resolved against the launcher's directory could not name its own.
		const child = fork(cliEntry, ["-c", config, dir], { env, cwd: dir, silent: true, execArgv: [] });
		superviseChild(child); // owned for the life of THIS process: a staying session that ends by signal takes its children with it
		const stderrTail = new RunTail(STDERR_TAIL_CHARS);
		child.stderr?.on("data", (data: Buffer) => {
			process.stderr.write(`[instance:${hostId}] ${data.toString()}`);
			stderrTail.append(data.toString());
		});
		// An instance that never becomes ready has usually said why on its own output rather than to its error stream,
		// and a caller told only that it timed out has to go and start it by hand to find out. The tail is kept, not
		// echoed: it is the instance's event stream, and only its last words are of interest here.
		const saidTail = new RunTail(STDERR_TAIL_CHARS);
		child.stdout?.on("data", (data: Buffer) => saidTail.append(data.toString()));
		this.children.push({ child, label: `${dir} host ${hostId}`, launch: { dir, config, port, hostId } });

		const url = `http://localhost:${port}`;
		const rpc = new RpcClient({ baseUrl: url, timeoutMs: 1_500, retry: { maxAttempts: 1 } });
		const deadline = Date.now() + READY_DEADLINE_MS;
		while (Date.now() < deadline) {
			if (child.exitCode !== null) {
				const said = stderrTail.since(0).output;
				return actionNotOK(`instance at ${dir} exited before ready (code ${child.exitCode})${said ? `\n${said}` : ""}`);
			}
			const result = await rpc.call<{ hostId?: number; site?: string; serving?: boolean }>("action.begin", {}, []);
			if (typeof (result as { error?: unknown }).error !== "string") {
				const begun = result as { hostId?: number; site?: string; serving?: boolean };
				// Ready means serving: the instance's feature has run everything it sets up. Its port answers earlier, and a
				// caller that took that as ready would race whatever the feature does after listening.
				if (begun.serving !== true) {
					await new Promise((r) => setTimeout(r, READY_POLL_MS));
					continue;
				}
				// The handshake verifies the child took the assigned identity; a silently-wrong hostId would break seqPath and site uniqueness.
				if (begun.hostId !== hostId) return actionNotOK(`instance at ${url} reports hostId ${begun.hostId}, expected ${hostId}`);
				if (typeof begun.site !== "string" || begun.site.length === 0) return actionNotOK(`instance at ${url} did not report a site principal`);
				return actionOKWithProducts({ url, site: begun.site, hostId });
			}
			await new Promise((r) => setTimeout(r, READY_POLL_MS));
		}
		const lastSaid = stderrTail.since(0).output || saidTail.since(0).output;
		return actionNotOK(`instance at ${dir} not ready on ${url} within ${READY_DEADLINE_MS}ms${lastSaid ? `\n${lastSaid}` : ""}`);
	}
}
