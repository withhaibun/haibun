/**
 * TestRunnerStepper is the development-flow agent: it runs a named test, watches it, examines what came out, probes
 * the run while it stands, and says what it found in the discourse where a person answers it.
 *
 * THE RULE THIS FOLLOWS: the agent's tool surface IS the step surface. Every tool it has is a step here, callable
 * the same three ways everything else is (a feature line, an RPC call, another agent), gated by the same
 * capabilities, and recorded as the same individuals. Nothing here adds a second way to call a tool, hold a session,
 * or record an act. Its memory is the graph; its transcript is the discourse; its story is the sequence.
 *
 * WHAT IT WILL NOT DO, by construction rather than by hope:
 *   - run two tests at once: one run is in flight per agent, and asking again while one is live answers with the
 *     live one, since a second run of the same features leaves two runs and no way to say which one failed;
 *   - re-run the same features with nothing changed: a re-run is refused unless something was applied since, or the
 *     asker asked for it in as many words;
 *   - run past its limits: they come from the environment, and reaching one ends the loop with a record saying which
 *     limit was reached and where it stood, rather than stopping quietly;
 *   - leave runs standing without limit: a run given a port holds that port until it is stopped, so starting one past
 *     the standing limit is refused, naming the runs to stop.
 *
 * WHAT COMES FROM THE ENVIRONMENT, never from source: which model answers, where it is, and what it may spend. The
 * bulky router is one such environment; a hosted API is another. No step, feature or default here names a model.
 */
import path from "node:path";
import { z } from "zod";
import { AStepper, type IHasCycles, type IHasOptions, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts, boolOrError, getStepperOption, intOrError } from "@haibun/core/lib/util/index.js";
import { callStepFrom } from "@haibun/core/lib/call-step.js";
import { invokingPrincipal } from "@haibun/core/lib/step-dispatch.js";
import { askedIn } from "@haibun/core/lib/capability-context.js";
import { persistPrincipalIndividual } from "@haibun/core/lib/principal-individual.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { RUN_STATUS, FEATURE_EXECUTION_LABEL, FEATURE_EXECUTION_DOMAIN, statusOfExit, featureExecutionDomainDefinition, type TFeatureExecution, type TRunStatus } from "./feature-execution.js";
import { SUPERVISOR_CAPABILITIES, runReadSchema, runStartedSchema } from "./instance-stepper.js";
import { bareMethodName, hostOfMethodName, hostScopedMethodName } from "@haibun/core/lib/step-registry.js";
import { examineRun } from "./run-outcome.js";
import { forgetOutcomes } from "./verified.js";

/** The supervisor steps this agent's tools call. A run is started, read and stopped by the instance supervisor; this
 *  stepper decides what may be run and records what came of it, and holds neither a process nor a port.
 *
 *  Each tool declares the capability of the supervisor step it calls, not one of its own, so starting a run through
 *  this stepper requires the same capability as starting one directly. One action, one capability, whatever the
 *  route to it. */
const SUPERVISOR = { start: "InstanceStepper-startRun", read: "InstanceStepper-readRun", wait: "InstanceStepper-waitRun", stop: "InstanceStepper-stopRun" } as const;

/** What a run answered, as much of it as an answer can carry: the whole of a small one, and a large one's own
 *  summary fields with a note of what was left, since a listing of a busy run is longer than a model's window. */
export function answerOfRun(products: Record<string, unknown>): { text: string; answer: string } {
	// What the run says about itself comes first, and its listings are counted rather than repeated: a reader asking
	// how many reads the front of an answer, and a listing pushes the count past where it stops. The whole of it is
	// there for a caller that wants the entries, and only the summary is handed to a model.
	const entries = Object.entries(products);
	const ordered = [...entries.filter(([, value]) => !Array.isArray(value)), ...entries.filter(([, value]) => Array.isArray(value))];
	const counted = ordered.map(([name, value]) => [name, Array.isArray(value) ? `${value.length} entries; ask the run for one to see it` : value]);
	return { text: bounded(JSON.stringify(Object.fromEntries(counted))), answer: bounded(JSON.stringify(Object.fromEntries(ordered))) };
}

/** As much of an answer as one can carry, saying how much was left: a busy run's listing is longer than a window. */
function bounded(answer: string): string {
	return answer.length <= ANSWER_LIMIT ? answer : `${answer.slice(0, ANSWER_LIMIT)} ... (${answer.length} characters in all)`;
}

const ANSWER_LIMIT = 4000;

/** A feature line's argument arrives quoted where it holds spaces; a model writes it plain. Either way it is the value. */
const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/s, "$1");

/** The step a name asks for: the name that host knows it by, or the step half of one where that names exactly one
 *  step there. A caller writing `listTyped` where the host knows it as `Something-listTyped` has named one step and no other. */
export function stepAtRun(atRun: TRunStep[], host: number, method: string): TRunStep | undefined {
	const named = atRun.find((step) => step.name === hostScopedMethodName(host, method));
	if (named) return named;
	const byStep = atRun.filter((step) => bareMethodName(step.name).split("-").at(-1) === method);
	return byStep.length === 1 ? byStep[0] : undefined;
}

/** What a caller with a wrong name is reaching for, read from what the run itself declares: a list of everything it
 *  answers is a menu, while the steps that LIST what it holds are what "how many" wants. Which those are is the far
 *  side's own business — a step naming them here would be this process deciding what another one offers. */
function recipeAtRun(atRun: TRunStep[]): string {
	const listing = atRun.filter((step) => LISTS_WHAT_IT_HOLDS.test(step.description ?? "")).map((step) => bareMethodName(step.name));
	return listing.length > 0 ? `To count or list what it holds of a type, ask ${listing.slice(0, 3).join(" or ")}. ` : "";
}

/** How a step says it lists what a run holds: its own description, in the words it declares itself with. */
const LISTS_WHAT_IT_HOLDS = /\blists?\b/i;

/** A step at a standing run, as the registry holds it: its host-scoped name, what it takes, and how it describes itself. */
type TRunStep = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } };

/**
 * The parameters of a question put to a run, as a feature line or a model can write them: `name=value` pairs, or
 * JSON from a caller that can write it. A quoted feature-line argument holds no double quotes, so pairs are what a
 * line can say. A step that takes one parameter also accepts the bare value, since naming it adds nothing.
 */
export function askParams(params: string, takes: string[] = []): Record<string, unknown> {
	const text = unquote(params);
	if (text === "" || text === "{}") return {};
	if (text.startsWith("{")) return JSON.parse(text) as Record<string, unknown>;
	if (!text.includes("=") && takes.length === 1) return { [takes[0]]: text };
	const asValue = (value: string): unknown => {
		if (value === "true" || value === "false") return value === "true";
		return value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
	};
	return Object.fromEntries(
		text
			.split(",")
			.map((pair) => pair.split("="))
			.filter(([name, value]) => name?.trim() && value !== undefined)
			.map(([name, ...rest]) => [name.trim(), asValue(rest.join("=").trim())]),
	);
}

/** How much of a followed run's output is answered with. The whole of a suite's output is not a reading; its end is
 *  where the outcome is. The supervisor still holds the rest, readable from a cursor. */
const RUN_ANSWER_CHARS = 8_000;
const lastOf = (output: string): string => (output.length <= RUN_ANSWER_CHARS ? output : output.slice(-RUN_ANSWER_CHARS));

/** The agent's own Principal: one standing author per instance, so a session's findings read as one voice and an
 *  attribution reaches a record rather than a string. Its name says which agent, since a graph may hold several. */
export const TEST_RUNNER_AUTHOR = "agent:test-runner";

/** What the environment decides. Every one has a default that is a limit rather than a preference, so an agent with no
 *  configuration still cannot run away. */
export const RUNNER_DEFAULTS = { maxRuns: 3, port: 0, maxStanding: 2, hostId: 9 } as const;

/** One run this agent started, as it tracks it between tool calls: the supervisor holds the process, this holds why
 *  it was started and how far its output has been read. */
type TTrackedRun = {
	id: string;
	filter: string;
	where: string;
	cursor: number;
	status: TRunStatus;
	startedAt: string;
	endpoint: string;
	attributedTo: string;
	askedIn?: string;
	report?: string;
	/** The host this run answers as, when it stays; zero when it ends with its features. */
	host: number;
	/** What the supervisor last reported about this run, which is what its record is written from. */
	reported?: z.infer<typeof runReadSchema>;
};

export default class TestRunnerStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "An agent that runs named tests, watches them, probes what they left standing, and reports what it found into the discourse";

	cycles: IStepperCycles = {
		getConcerns: () => ({ domains: [featureExecutionDomainDefinition] }),
	};

	options = {
		MAX_RUNS: {
			desc: `most test runs the agent may start while answering one ask (default ${RUNNER_DEFAULTS.maxRuns})`,
			parse: (input: string) => intOrError(input),
		},
		RUN_FROM: {
			desc: "directory a run is started from, when that is not the base itself. A base whose config names steppers by a path relative to its parent is run from that parent, as its own command line does",
			parse: (input: string) => ({ result: input }),
		},
		RUN_STANDS: {
			desc: "leave a run standing when its features finish, holding its port so it can be asked about (default off). A run's port is set by RUN_PORT whether or not it stands, so a run can be moved off a busy port without being left holding one",
			parse: (input: string) => boolOrError(input),
		},
		MAX_STANDING: {
			desc: `most runs that may stand at once, waiting to be asked about (default ${RUNNER_DEFAULTS.maxStanding}). A standing run holds its port until it is stopped, so a session that starts them without stopping them is refused rather than left holding ports`,
			parse: (input: string) => intOrError(input),
		},
		RUN_HOST_ID: {
			desc: `host id a standing run takes, so its steps register here as that host's and are called with \`on host {id}, <step>\` (default ${RUNNER_DEFAULTS.hostId})`,
			parse: (input: string) => intOrError(input),
		},
		RUN_PORT: {
			desc: "port a started run's own web server takes, so two runs can go at once without meeting on a default. Zero, the default, leaves the run to whatever ports its features declare, which a suite asserting a default port needs",
			parse: (input: string) => intOrError(input),
		},
	};

	/** The run in flight, if any. One at a time: a second run started while this one is live would leave two runs and
	 *  no way to say which of them a finding is about. */
	private inFlight: TTrackedRun | undefined;
	/** Every run started while answering the current ask, so a cap is counted against the ask rather than for ever. */
	private runsThisAsk: TTrackedRun[] = [];
	/** The last run this agent started, whichever ask started it. An operator asks about a test after the exchange that
	 *  ran it, so a question in a later ask is about that run, and an answer saying none was started is false. */
	private lastRun: TTrackedRun | undefined;
	/** Why the last attempt to start a run failed, so a step that finds no run says what became of it. */
	private lastFailure = "";
	/** Runs given a port, which stand after their features finish and hold that port until they are stopped. */
	private standing = new Map<string, TTrackedRun>();
	private principalWritten = new WeakSet<object>();
	/** The steppers this run was set up with: the agent's tools are their steps, reached by name. */
	steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	steps = {
		runTest: {
			gwta: `run the tests in {where} matching {filter}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description:
				"Start a run of the named features and record it, so what happens next can be said to be about it. The products are that record: its id, and its endpoint and host where it stands. One run at a time: asking while a run is live answers with the live run rather than starting a second, and features that have run against the present state of what they depend on are not run again until that state changes or a change is noted.",
			// The record the run starts as is the products, so `feature-execution` is a GOAL: resolve it and this step
			// is the michi, and running a remote test is something the resolver can offer rather than only prose can.
			productsDomain: FEATURE_EXECUTION_DOMAIN,
			action: async ({ where, filter }: { where: string; filter: string }) => await this.askedToRun(where, filter),
		},
		runAllTests: {
			gwta: `run all the tests in {where}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description: "Start a run of every feature in a directory, answering with its record. The same limits as a filtered run: one at a time, and not again while what the features depend on is as it was when they last ran.",
			productsDomain: FEATURE_EXECUTION_DOMAIN,
			action: async ({ where }: { where: string }) => await this.askedToRun(where, ""),
		},
		readTestRun: {
			gwta: `read the test run`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"What the run in flight has said since this was last asked, and whether it is still going. When the run has ended, its record is closed with what its exit code says, which is what releases the next run.",
			productsSchema: z.object({ run: z.string(), status: z.string(), exitCode: z.string(), output: z.string() }),
			action: async () => {
				const tracked = this.inFlight;
				if (!tracked) return actionNotOK(this.nothingToRead("read"));
				const read = await this.callSupervisor(runReadSchema, SUPERVISOR.read, { run: tracked.id, cursor: tracked.cursor });
				if (read.ok === false) return actionNotOK(read.why);
				const { status, exitCode, cursor, output } = read.products;
				tracked.cursor = cursor;
				tracked.reported = read.products;
				if (status === "ended" || read.products.finished) {
					await this.finishRun(exitCode, status === "ended" ? undefined : read.products.failed > 0 ? RUN_STATUS.failed : RUN_STATUS.passed);
					await this.recordOutcome(tracked);
				}
				return actionOKWithProducts({ run: tracked.id, status, exitCode: String(exitCode ?? ""), output });
			},
		},
		awaitTestRun: {
			gwta: `wait until the test run ends within {seconds: number} seconds`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Follow the run in flight to its end and answer with how it ended and its last output. The supervisor answers the moment the run exits, so this costs one call however long the run takes. The wait is bounded: reaching the limit is a failure naming how long it waited, never a longer wait, so a run that hangs ends the ask rather than the process.",
			productsSchema: z.object({ run: z.string(), status: z.string(), exitCode: z.string(), output: z.string() }),
			action: async ({ seconds }: { seconds: number }) => {
				const tracked = this.inFlight;
				if (!tracked) return actionNotOK(this.nothingToRead("wait for"));
				// The supervisor holds the child, so it answers when the run ends. Nothing here asks repeatedly.
				const waited = await this.callSupervisor(runReadSchema, SUPERVISOR.wait, { run: tracked.id, seconds, cursor: tracked.cursor });
				if (waited.ok === false) return actionNotOK(waited.why);
				const seen = waited.products;
				tracked.cursor = seen.cursor;
				tracked.reported = seen;
				const said = lastOf(seen.output);
				// A run that was left standing reports that its features are over and goes on serving, so it is done
				// without having exited; how it went is then what it said about itself rather than an exit code.
				if (seen.status !== "ended" && !seen.finished)
					return actionNotOK(`the run "${tracked.filter}" had not ended after ${seconds} seconds; read it, or stop it, rather than waiting again`);
				const status = seen.status === "ended" ? statusOfExit(seen.exitCode) : seen.failed > 0 ? RUN_STATUS.failed : RUN_STATUS.passed;
				// A run that reported its features over without exiting has no exit code to read the outcome from, so
				// what it said about itself is the outcome.
				await this.finishRun(seen.exitCode, seen.status === "ended" ? undefined : status);
				await this.recordOutcome(tracked);
				// A run that failed is a failed step. Answering ok for it would report a passing suite from a run that
				// never collected a feature, which is the one thing a test runner must not do.
				if (status !== RUN_STATUS.passed) return actionNotOK(`the run "${tracked.filter}" ${status} (exit ${seen.exitCode}). Its last output:\n${said}`);
				return actionOKWithProducts({ run: tracked.id, status, exitCode: String(seen.exitCode ?? ""), output: said });
			},
		},
		examineTestRun: {
			gwta: `examine the test run`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"What the run reported: how it said it ended, every step it recorded as failed with the seqPath it failed at, and where it wrote its report. All of it is the run's own words. A run whose output is formatted for a person carries no step events, and then the step count is absent rather than zero; the summary and the report say how it went. The report path is recorded on the run, so a later reader reaches it from the record.",
			productsSchema: z.object({ run: z.string(), summary: z.string(), failures: z.string(), report: z.string(), steps: z.string(), features: z.string() }),
			action: async () => {
				const tracked = this.inFlight ?? this.runsThisAsk.at(-1);
				if (!tracked) return actionNotOK(this.nothingToRead("examine"));
				const read = await this.callSupervisor(runReadSchema, SUPERVISOR.read, { run: tracked.id, cursor: 0 });
				if (read.ok === false) return actionNotOK(read.why);
				const { output } = read.products;
				tracked.reported = read.products;
				await this.recordOutcome(tracked);
				// The failing steps in detail come from the tail, which holds what the run last said; the counts come
				// from the run's whole output, which the supervisor accrued as it arrived.
				const { failures } = examineRun(output);
				return actionOKWithProducts({
					run: tracked.id,
					summary: read.products.summary,
					failures: JSON.stringify(failures),
					report: read.products.report,
					steps: String(read.products.steps),
					features: String(read.products.features),
				});
			},
		},
		askTestRun: {
			gwta: `ask the test run to {method} with {params}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			// Offered once there is a run to ask about, and not before: a model that sees it with nothing started asks a
			// run that does not exist rather than starting one.
			offeredBeforeDiscovery: () => this.startedARun(),
			description:
				"Ask the standing test run one of its own steps, by the name it has there. Ask LlmStepper-discoverToolsAtHost for those names first; a wrong one is answered with the names that host does have. The step runs AT the run, under the same capability check as any step, and answers with what that run holds rather than what this one does. Parameters are name=value pairs; a step taking one parameter also accepts the bare value. Use this whenever the question is about the test rather than about this run; every other step answers from this run.",
			// A model is handed the product named text for a tool call, so that is the summary; the whole answer, with the
			// entries a listing returned, is beside it for a caller that asked for them.
			productsSchema: z.object({ run: z.string(), host: z.string(), method: z.string(), text: z.string(), answer: z.string() }),
			action: async ({ method, params }: { method: string; params: string }) => {
				const tracked = this.inFlight ?? [...this.standing.values()].at(-1) ?? this.runsThisAsk.at(-1) ?? this.lastRun;
				if (!tracked)
					return actionNotOK("no test run has been started here, so there is nothing to ask; start one first, with TestRunnerStepper-runTest or TestRunnerStepper-runAllTests");
				// A run that is gone still has a record here, and that is what an operator asking about it after the fact
				// is answered from; saying nothing was started, or leaving a model to guess where the run went, is false.
				if (!tracked.host || (!this.inFlight && !this.standing.has(tracked.id)))
					return actionNotOK(
						`the run "${tracked.filter}" in "${tracked.where}" is no longer up, so it answers nothing now; what is left of it is its record here, which TestRunnerStepper-examineTestRun and a list of "feature-execution" report`,
					);
				const atRun = this.stepsAtRun(tracked.host);
				const target = stepAtRun(atRun, tracked.host, unquote(method));
				const scoped = target?.name ?? hostScopedMethodName(tracked.host, unquote(method));
				if (atRun.length && !target)
					return actionNotOK(
						`the test run at host ${tracked.host} has no step called ${method}. ${recipeAtRun(atRun)}It answers ${atRun
							.map((step) => bareMethodName(step.name))
							.slice(0, 12)
							.join(", ")}`,
					);
				const takes = Object.keys(target?.inputSchema?.properties ?? {});
				const given = askParams(params, takes);
				// A step called without what it takes fails inside the run with a message about a parameter, which reads as
				// a fault of the run. Said here, it names the step's own parameters, which is what a caller has to correct.
				const missing = (target?.inputSchema?.required ?? takes).filter((name) => given[name] === undefined);
				if (missing.length)
					return actionNotOK(
						`${method} at host ${tracked.host} takes ${takes.join(", ") || "no parameters"}, and was given ${Object.keys(given).join(", ") || "nothing"}: ${missing.join(", ")} missing`,
					);
				const asked = await this.callSupervisor(z.object({}).passthrough(), scoped, given);
				// A refusal IS an answer: the run is up and said why it would not. Left as a bare failure, a reader took
				// "was asked X: not a declared type" for an unreachable run and answered from the wrong instance.
				if (asked.ok === false) return actionNotOK(`the test run at host ${tracked.host} answered ${method} with a refusal, so it is up: ${asked.why}`);
				return actionOKWithProducts({ run: tracked.id, host: String(tracked.host), method, ...answerOfRun(asked.products) });
			},
		},
		noteSourceChanged: {
			gwta: `note that {filter} in {where} has changed`,
			description:
				"Say that something was applied to the features named, so they run again whatever their dependencies show. A run of features that have run against their present state answers what that run answered, whether it passed or failed, so it is refused until their state changes or this is said.",
			action: ({ filter, where }: { filter: string; where: string }) => {
				this.noteApplied(filter, where);
				return Promise.resolve(actionOK());
			},
		},
		noteEverythingChanged: {
			gwta: `note that the tests in {where} have changed`,
			description: "The same, for a run of every feature in a base. An unnamed set of features is not an empty name, so it has its own line rather than an empty argument.",
			action: ({ where }: { where: string }) => {
				this.noteApplied("", where);
				return Promise.resolve(actionOK());
			},
		},
		stopTestRun: {
			gwta: `stop the test run`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			description: "End the run in flight and release its port. A run is left standing after its features finish, so it is stopped when there is nothing left to ask it.",
			action: async () => {
				// A run whose features are over may still be standing, holding its port for anything that wants to ask
				// it something. Stopping is what ends that, so it is not limited to a run still in flight.
				const tracked = this.inFlight ?? [...this.standing.values()].at(-1);
				if (!tracked) return actionNotOK("no run is in flight or standing, so there is nothing to stop");
				const stopped = await this.callSupervisor(z.object({ run: z.string() }), SUPERVISOR.stop, { run: tracked.id });
				if (stopped.ok === false) return actionNotOK(stopped.why);
				this.standing.delete(tracked.id);
				tracked.status = RUN_STATUS.stopped;
				this.inFlight = this.inFlight === tracked ? undefined : this.inFlight;
				await this.writeRun(tracked, { endedAt: new Date().toISOString() });
				return actionOK();
			},
		},
	};

	/** What every ask to run comes through, whether it named features or asked for all of them: the limits are here, so
	 *  neither form can go around them. An empty filter runs every feature the base holds. */
	private async askedToRun(where: string, filter: string) {
		if (this.inFlight) return actionNotOK(`a run is already in flight: "${this.inFlight.filter}" (${this.inFlight.id}); read it before starting another`);
		const standingCap = this.cap("MAX_STANDING", RUNNER_DEFAULTS.maxStanding);
		if (this.runStands() && this.standing.size >= standingCap)
			return actionNotOK(`${this.standing.size} runs are already standing, which is the limit: stop one of ${[...this.standing.keys()].join(", ")} before starting another`);
		if (this.runsThisAsk.length >= this.cap("MAX_RUNS", RUNNER_DEFAULTS.maxRuns))
			return actionNotOK(`the run budget for this ask is spent (${this.runsThisAsk.length} runs); say what was found rather than running again`);
		// A run of features that have passed against their present state is refused where it would be started: the
		// supervisor keeps the record, so what was applied since is read from the features' own dependencies rather
		// than remembered here.
		const run = await this.startRun(where, filter);
		if ("why" in run) {
			// What went wrong is kept, so the steps that follow answer with it: a caller told only "no run is in flight"
			// has to go looking for a failure it was already told about, and an agent has nothing to report at all.
			this.lastFailure = run.why;
			return actionNotOK(run.why);
		}
		this.lastFailure = "";
		// The record IS the products: the run as its individual stands, which is what the goal resolver asserts as the
		// satisfied `feature-execution` and what a caller reads the id, endpoint and host from — the host being how a
		// standing run is addressed afterwards (`on host {host}, <step>`); a run that ends with its features carries none.
		return actionOKWithProducts(run.record as unknown as Record<string, unknown>);
	}

	/**
	 * One call of a supervisor step, answered by the schema that step declares, so the products are parsed rather than
	 * asserted and a wrong shape fails here. The missing-supervisor case is named: the agent cannot run a test in a
	 * process where run supervision was never registered, and saying so is more use than a step that is simply absent.
	 */
	/** Why there is no run to work with: the failure that stopped the last one from starting, where there was one, so a
	 *  caller is answered with what happened rather than with its consequence. */
	private nothingToRead(what: string): string {
		return this.lastFailure ? `there is no run to ${what}: the last one did not start — ${this.lastFailure}` : `no run has been started in this ask, so there is nothing to ${what}`;
	}

	/** Whether this agent has a run to be asked about at all: one in flight, one standing, or one it started earlier
	 *  whose record is what is left of it. */
	private startedARun(): boolean {
		return !!(this.inFlight ?? [...this.standing.values()].at(-1) ?? this.runsThisAsk.at(-1) ?? this.lastRun);
	}

	/** What a standing run answers to, as this registry knows it: the steps its transport injected under its host,
	 *  with what each takes. An empty list means nothing was injected, so a call is passed on as written. */
	private stepsAtRun(host: number): TRunStep[] {
		const registry = this.getWorld().runtime.stepRegistry as { list?: () => TRunStep[] } | undefined;
		if (!registry?.list) return [];
		return registry.list().filter((step) => hostOfMethodName(step.name) === host);
	}

	private async callSupervisor<S extends z.ZodTypeAny>(
		schema: S,
		method: string,
		input: Record<string, unknown>,
	): Promise<{ ok: true; products: z.infer<S> } | { ok: false; why: string }> {
		const called = await callStepFrom(this, method, input);
		if (!called.registered) return { ok: false, why: `${method} is not registered; run supervision comes from @haibun/cli's InstanceStepper, which this run has to include` };
		if (!called.result.ok) return { ok: false, why: `${method}: ${called.result.errorMessage ?? "(no message)"}` };
		const parsed = schema.safeParse(called.result.products ?? {});
		if (!parsed.success) return { ok: false, why: `${method} answered with something else than it declares: ${parsed.error.message}` };
		return { ok: true, products: parsed.data as z.infer<S> };
	}

	/** The cap the environment set, or the built-in bound. A misconfigured cap is a hard failure at read time, not a
	 *  silently unlimited agent. */
	private cap(option: "MAX_RUNS" | "MAX_STANDING" | "RUN_PORT" | "RUN_HOST_ID", fallback: number, { zeroMeans }: { zeroMeans?: string } = {}): number {
		const configured = getStepperOption(this, option, this.getWorld().moduleOptions);
		if (configured === undefined) return fallback;
		const parsed = Number(configured);
		const floor = zeroMeans ? 0 : 1;
		if (!Number.isInteger(parsed) || parsed < floor)
			throw new Error(`${option} must be a whole number ${zeroMeans ? `of at least zero, where zero is ${zeroMeans}` : "of at least one"}, not "${configured}"`);
		return parsed;
	}

	/** Whether a run started now is left standing when its features finish. */
	private runStands(): boolean {
		const configured = getStepperOption(this, "RUN_STANDS", this.getWorld().moduleOptions);
		return configured === undefined ? false : Boolean(boolOrError(String(configured)).result);
	}

	/** Who a run started now is attributed to: the principal controlling the capability the call ran under, or this
	 *  agent when the call carried no capability. */
	private actingPrincipal(): string {
		return invokingPrincipal(this.getWorld()) ?? TEST_RUNNER_AUTHOR;
	}

	/** Write the agent's Principal once per store, so every finding it writes attributes to a record. */
	private async ensureAgentPrincipal(): Promise<void> {
		const store = this.getWorld().shared.getStore() as object;
		if (this.principalWritten.has(store)) return;
		this.principalWritten.add(store);
		await persistPrincipalIndividual(this.getWorld(), {
			id: TEST_RUNNER_AUTHOR,
			name: "test runner agent",
			controller: TEST_RUNNER_AUTHOR,
			generatedAtTime: new Date().toISOString(),
		});
	}

	/** Start a run through the supervisor and record it as an individual, so a finding has something to point at. */
	private async startRun(where: string, filter: string): Promise<{ ok: true; record: TFeatureExecution } | { ok: false; why: string }> {
		await this.ensureAgentPrincipal();
		const port = this.cap("RUN_PORT", RUNNER_DEFAULTS.port, { zeroMeans: "the run's own ports" });
		const stands = this.runStands();
		if (stands && port === 0) return { ok: false, why: "a standing run needs a port: set RUN_PORT, or leave RUN_STANDS off" };
		const startedAt = new Date().toISOString();
		const id = `run:${filter}:${startedAt}`;
		// Only a run left standing answers afterwards, so only such a run has an endpoint to record.
		const endpoint = stands ? `http://localhost:${port}` : "";
		const from = (getStepperOption(this, "RUN_FROM", this.getWorld().moduleOptions) as string | undefined) ?? where;
		// A run that stays takes a host id, which is how it is addressed afterwards; a run that ends takes none.
		const hostId = stands ? this.cap("RUN_HOST_ID", RUNNER_DEFAULTS.hostId) : 0;
		const started = await this.callSupervisor(runStartedSchema, SUPERVISOR.start, { where, filter, from, port, run: id, hostId });
		if (started.ok === false) return { ok: false, why: started.why };
		const tracked: TTrackedRun = {
			id,
			filter,
			where,
			cursor: 0,
			status: RUN_STATUS.running,
			startedAt,
			endpoint,
			attributedTo: this.actingPrincipal(),
			askedIn: askedIn(),
			host: hostId,
		};
		this.inFlight = tracked;
		this.lastRun = tracked;
		this.runsThisAsk.push(tracked);
		if (endpoint) this.standing.set(id, tracked);
		const record = await this.writeRun(tracked);
		return { ok: true, record };
	}

	/** The run's record as it stands, with whatever this write adds to it. One shape, so a field added to a TestRun is
	 *  added once. Returned as written, so the step that started the run can answer with the record itself — which is
	 *  what lets `feature-execution` stand as a goal the resolver reaches through runTest. */
	private async writeRun(run: TTrackedRun, extra: Record<string, unknown> = {}): Promise<TFeatureExecution> {
		const record = {
			id: run.id,
			where: run.where,
			filter: run.filter,
			status: run.status,
			...(run.endpoint ? { endpoint: run.endpoint } : {}),
			startedAt: run.startedAt,
			...(run.report ? { report: run.report } : {}),
			attributedTo: run.attributedTo,
			...(run.askedIn ? { inReplyTo: run.askedIn } : {}),
			...(run.host > 0 ? { host: run.host } : {}),
			generatedAtTime: new Date().toISOString(),
			...extra,
		} as TFeatureExecution;
		await this.getWorld().shared.getStore().upsertIndividual(FEATURE_EXECUTION_LABEL, record);
		return record;
	}

	/**
	 * Put what the run did on its record: how many features and steps it ran, how many failed, the first failure, and
	 * where its report is. A reader with the run then has its outcome, without having to have kept what an examine
	 * answered at the time.
	 */
	private async recordOutcome(run: TTrackedRun): Promise<void> {
		const reported = run.reported;
		if (!reported) return;
		if (reported.report) run.report = reported.report;
		await this.writeRun(run, {
			features: reported.features,
			steps: reported.steps,
			failed: reported.failed,
			...(reported.firstFailure ? { firstFailure: reported.firstFailure } : {}),
		});
	}

	/** Forget how the features named last ran against their state, so they run again whatever it is: what a caller
	 *  says when something was applied that their dependencies do not show, or when the run is wanted regardless. No
	 *  features named is every feature of the base. */
	noteApplied(filter: string, where = ""): void {
		forgetOutcomes(path.resolve(where || "."), filter || undefined);
	}

	/** Close out the run in flight with what its exit code says, and let the next run start. A run ended by the agent
	 *  rather than by its own features carries that as its status, since no exit code answers for it. */
	async finishRun(exitCode: number | null, ended?: TRunStatus): Promise<void> {
		const run = this.inFlight;
		if (!run) return;
		const status = ended ?? statusOfExit(exitCode);
		run.status = status;
		this.inFlight = undefined;
		const endedAt = new Date().toISOString();
		if (ended === RUN_STATUS.stopped) this.standing.delete(run.id);
		await this.writeRun(run, { endedAt, generatedAtTime: endedAt });
	}

	/** A fresh ask starts a fresh budget: the caps bound one answer, not the life of the process. */
	beginAsk(): void {
		this.runsThisAsk = [];
	}

	/** What the agent has spent answering the current ask: what a refusal quotes, and what the tests read. */
	spend(): { runs: number; inFlight: string | undefined } {
		return { runs: this.runsThisAsk.length, inFlight: this.inFlight?.id };
	}
}
