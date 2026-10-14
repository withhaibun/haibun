/**
 * TestRunnerStepper implements the development-flow agent. It starts a named test run, follows it, examines its output,
 * calls steps of a standing test run, and records each test run as an individual. The agent reports its findings in the
 * discourse, where a person replies.
 *
 * The agent's tools are this stepper's steps. A feature line, an RPC request or another agent calls each tool the same way.
 * The same capabilities gate each call, and each call is recorded as the same individuals. This stepper doesn't add a
 * second way to call a tool, hold a session or record an act. The graph stores its records. The discourse stores its
 * transcript. The sequence view shows its steps in order.
 *
 * The code refuses these cases:
 *   - Two test runs at once. One test run is in flight per stepper. A start while one is in flight is refused with the
 *     id of the test run in flight, since two test runs of the same features wouldn't show which one failed.
 *   - A repeat test run of features whose dependencies haven't changed. The supervisor refuses it until a dependency
 *     changes or a caller notes a change with noteSourceChanged or noteEverythingChanged.
 *   - More test runs than MAX_RUNS. The step fails with a message that states the count.
 *   - More standing test runs than MAX_STANDING. A standing test run holds its port until it is stopped, so a start
 *     past the limit is refused with the ids of the test runs to stop.
 *
 * The environment sets the model, its endpoint and the steps it may call. Source doesn't set them. The endpoint can be a
 * self-hosted model router or a hosted API. The steps, features and defaults here don't name a model.
 */
import type { TInputSchema, TStepDescriptor } from "@haibun/core/lib/step-discovery.js";
import path from "node:path";
import { z } from "zod";
import { fromJsonText, JsonObjectTextSchema } from "@haibun/core/lib/json-text.js";
import { AStepper, type IHasCycles, type IHasOptions, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOK, actionOKWithProducts, boolOrError, getStepperOption, intOrError } from "@haibun/core/lib/util/index.js";
import { localOrigin } from "@haibun/core/lib/local-origin.js";
import { callStepFrom } from "@haibun/core/lib/call-step.js";
import { actingAs } from "@haibun/core/lib/capability-context.js";
import { askedIn } from "@haibun/core/lib/capability-context.js";
import { persistPrincipalIndividual } from "@haibun/core/lib/principal-individual.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import {
	RUN_STATUS,
	FEATURE_EXECUTION_LABEL,
	FEATURE_EXECUTION_DOMAIN,
	statusOfExit,
	statusOfExecution,
	featureExecutionDomainDefinition,
	type TFeatureExecution,
	type TRunStatus,
} from "./feature-execution.js";
import { RUN_DOMAIN, SUPERVISOR_CAPABILITIES, featureFilterDomainDefinition, runReadSchema, runStartedSchema } from "./instance-stepper.js";
import { bareMethodName, hostOfMethodName, hostScopedMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { runRegistry } from "@haibun/core/lib/step-registry.js";
import { examineRun } from "./run-outcome.js";
import { StepFailureSchema, isLevelEnd } from "@haibun/core/lib/actuality/machines/actuality.js";
import { forgetOutcomes } from "./verified.js";
import { DOMAIN_FILE_PATH } from "@haibun/core/lib/domains.js";

/** The InstanceStepper steps this stepper's tools call. InstanceStepper starts, reads and stops each test run. This
 *  stepper determines which test runs may start and records their outcomes. It doesn't hold a process or a port.
 *
 *  Each tool declares the capability of the supervisor step it calls, so starting a test run through this stepper
 *  requires the same capability as starting one through InstanceStepper. Each action requires one capability through either stepper. */
const SUPERVISOR = { start: "InstanceStepper-startRun", read: "InstanceStepper-readRun", wait: "InstanceStepper-waitRun", stop: "InstanceStepper-stopRun" } as const;

/** Converts the products of a step called on a test run into a tool result. `text` holds a summary and `answer` holds
 *  every field. Each is truncated at ANSWER_LIMIT characters, since a busy test run's listing can exceed a model's
 *  context window. */
export function answerOfRun(products: Record<string, unknown>): { text: string; answer: string } {
	// Non-array fields come first. `text` replaces each array with its length where the products state a `total`, since a
	// reader of a count doesn't read the entries. A step listing doesn't state a `total`, so `text` keeps its arrays.
	// `answer` holds the arrays for a caller that requests them.
	const entries = Object.entries(products);
	const ordered = [...entries.filter(([, value]) => !Array.isArray(value)), ...entries.filter(([, value]) => Array.isArray(value))];
	const counts = "total" in products;
	const counted = ordered.map(([name, value]) => [name, counts && Array.isArray(value) ? `${value.length} entries; read one through TestRunnerStepper-askTestRun` : value]);
	return { text: bounded(JSON.stringify(Object.fromEntries(counted))), answer: bounded(JSON.stringify(Object.fromEntries(ordered))) };
}

/** Truncates text at ANSWER_LIMIT characters and appends its full length. */
function bounded(answer: string): string {
	return answer.length <= ANSWER_LIMIT ? answer : `${answer.slice(0, ANSWER_LIMIT)} ... (${answer.length} characters in all)`;
}

const ANSWER_LIMIT = 4000;

/** The domains of the step name and the parameters a caller passes to askTestRun. */
const DOMAIN_ASKED_STEP = "asked-step";
const DOMAIN_ASKED_PARAMS = "asked-params";
/** Removes the quotes a feature line puts around an argument that contains spaces. A model writes the argument without quotes. */
const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/s, "$1");

/** Returns the step that a method name addresses on a host: the step with that host-scoped method name, or else the one
 *  step on that host whose step name matches. `listTyped` selects `Something-listTyped` where that host registers one
 *  `listTyped` step. */
export function stepAtRun(atRun: TStepDescriptor[], host: number, method: string): TStepDescriptor | undefined {
	const named = atRun.find((step) => step.method === hostScopedMethodName(host, method));
	if (named) return named;
	const byStep = atRun.filter((step) => step.stepName === method);
	return byStep.length === 1 ? byStep[0] : undefined;
}

/** Returns a hint that names up to three of the test run's listing steps, for a caller that named a step the test run
 *  doesn't register. A full list of the test run's steps doesn't show which step counts records, and a listing step
 *  does. LISTS_WHAT_IT_HOLDS selects those steps from the test run's own step declarations, so this process doesn't
 *  define what another process offers. */
function recipeAtRun(atRun: TStepDescriptor[]): string {
	const listing = atRun.filter((step) => LISTS_WHAT_IT_HOLDS.test(`${step.pattern} ${step.description ?? ""}`)).map((step) => bareMethodName(step.method));
	return listing.length > 0 ? `To count or list the test run's records of a type, call ${listing.slice(0, 3).join(" or ")}. ` : "";
}

/** Matches a step whose pattern or description contains "list" or "lists": such a step lists records. */
const LISTS_WHAT_IT_HOLDS = /\blists?\b/i;

/**
 * Parses the parameters a feature line or a model passes to askTestRun: `name=value` pairs, or JSON. A quoted feature
 * line argument can't contain double quotes, so a feature line writes pairs. A step that takes one parameter also
 * accepts a bare value for it, and JSON that doesn't name that parameter is its value. A parameter whose schema type is
 * object or array accepts its JSON text, as a feature line writes it.
 */
export function askParams(params: string, takes: TInputSchema["properties"] = {}): Record<string, unknown> {
	const [first, ...others] = Object.keys(takes);
	const only = others.length === 0 ? first : undefined;
	const text = unquote(params);
	if (text === "" || text === "{}") return {};
	const written = (): Record<string, unknown> => {
		if (text.startsWith("{")) {
			const parsed = JsonObjectTextSchema.parse(text);
			return only !== undefined && !(only in parsed) ? { [only]: parsed } : parsed;
		}
		if (!text.includes("=") && only !== undefined) return { [only]: text };
		const asValue = (value: string): unknown => {
			if (value === "true" || value === "false") return value === "true";
			return value !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
		};
		return Object.fromEntries(
			text.split(",").flatMap((pair) => {
				const at = pair.indexOf("=");
				const name = pair.slice(0, at).trim();
				return at < 0 || !name ? [] : [[name, asValue(pair.slice(at + 1).trim())]];
			}),
		);
	};
	const structured = (name: string, value: unknown): boolean => typeof value === "string" && ["object", "array"].includes(String(takes[name]?.type));
	return Object.fromEntries(Object.entries(written()).map(([name, value]) => [name, structured(name, value) ? fromJsonText(z.json()).parse(value) : value]));
}

/** Describes the values a parameter's schema accepts: its enum values, else its type. A message that names only the
 *  missing parameter doesn't show the caller what value to send. */
function whatItTakes(schema: Record<string, unknown> | undefined): string {
	if (Array.isArray(schema?.enum)) return ` (one of ${schema.enum.join(", ")})`;
	return typeof schema?.type === "string" ? ` (${/^[aeiou]/.test(schema.type) ? "an" : "a"} ${schema.type})` : "";
}

/** The number of trailing output characters awaitTestRun returns. A suite's outcome is at the end of its output. The
 *  supervisor keeps a bounded tail of the output, and examineTestRun reads that tail from cursor 0. */
const RUN_ANSWER_CHARS = 8_000;
const lastOf = (output: string): string => (output.length <= RUN_ANSWER_CHARS ? output : output.slice(-RUN_ANSWER_CHARS));

/** The id of the agent's Principal. Each instance has one such author, so a session's findings share one author, and an
 *  attribution references a Principal record instead of a string. The id names the agent, since a graph may hold several. */
export const TEST_RUNNER_AUTHOR = "agent:test-runner";

/** Defaults for the options the environment sets. maxRuns and maxStanding bound an agent without configuration. */
export const RUNNER_DEFAULTS = { maxRuns: 3, port: 0, maxStanding: 2, hostId: 9 } as const;

/** A test run this stepper started, as it is tracked between tool calls. The supervisor holds the process. This holds
 *  the filter, the attribution, the request that started the test run, and how far its output has been read. */
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
	/** The host id under which a standing test run's steps register; zero for a test run that ends with its features. */
	host: number;
	/** The supervisor's last read of the test run. recordOutcome writes the record from it. */
	reported?: z.infer<typeof runReadSchema>;
};

/** The products of readTestRun and awaitTestRun: the test run's output since the last read, and its status. */
const TestRunReadSchema = z.object({ run: z.string(), status: z.string(), exitCode: z.number().nullable(), output: z.string() });
/** The products of examineTestRun: the test run's summary, each failed step, its report path, and its feature and step
 *  counts. */
const TestRunExaminedSchema = z.object({
	run: z.string(),
	summary: z.string(),
	failures: z.array(StepFailureSchema),
	report: z.string().optional(),
	steps: z.number().optional(),
	features: z.number().optional(),
});
/** The products of askTestRun: `text` holds the summary a model receives, and `answer` holds the full response. */
const TestRunAnswerSchema = z.object({ run: z.string(), host: z.string(), method: z.string(), text: z.string(), answer: z.string() });
const DOMAIN_TEST_RUN_READ = "test-run-read";
const DOMAIN_TEST_RUN_EXAMINED = "test-run-examined";
const DOMAIN_TEST_RUN_ANSWER = "test-run-answer";

/** A test run's id, from its filter and the time it started. */
const runId = (filter: string, startedAt: string): string => `run:${filter}:${startedAt}`;

export default class TestRunnerStepper extends AStepper implements IHasOptions, IHasCycles {
	description = "An agent that starts named test runs, follows them, calls steps of the test runs left standing, and reports its findings in the discourse";

	cycles: IStepperCycles = {
		getConcerns: () => ({
			domains: [
				featureExecutionDomainDefinition,
				featureFilterDomainDefinition,
				{ selectors: [DOMAIN_TEST_RUN_READ], schema: TestRunReadSchema, description: "A test run's output since the last read, and its status" },
				{ selectors: [DOMAIN_TEST_RUN_EXAMINED], schema: TestRunExaminedSchema, description: "A test run's outcome: its summary, its failed steps and its report path" },
				{ selectors: [DOMAIN_TEST_RUN_ANSWER], schema: TestRunAnswerSchema, description: "A standing test run's response to a call of one of its own steps" },
				{
					selectors: [DOMAIN_ASKED_STEP],
					schema: z.string().min(1, "doesn't name a step"),
					description: "A step to call on a test run, by its host-scoped method name or the step part of that name",
				},
				{
					selectors: [DOMAIN_ASKED_PARAMS],
					schema: z.string(),
					description:
						"The parameters of a step called on a test run: name=value pairs, JSON, or the bare value of a step that takes one parameter; empty for a step that doesn't take a parameter",
				},
			],
		}),
	};

	options = {
		MAX_RUNS: { desc: `maximum test runs started until beginAsk resets the count (default ${RUNNER_DEFAULTS.maxRuns})`, parse: (input: string) => intOrError(input) },
		RUN_FROM: {
			desc: "working directory of a test run, where it differs from the base. Set it to the parent of a base whose config names steppers by paths relative to that parent. The base's own command line starts in that parent too",
			parse: (input: string) => ({ result: input }),
		},
		RUN_STANDS: {
			desc: "leave a test run standing when its features finish, holding its port for askTestRun (default off). RUN_PORT sets a test run's port whether or not it stands, so RUN_PORT moves a test run off a busy port without leaving it standing",
			parse: (input: string) => boolOrError(input),
		},
		MAX_STANDING: {
			desc: `maximum number of test runs standing at once for askTestRun (default ${RUNNER_DEFAULTS.maxStanding}). A standing test run holds its port until it is stopped, so a session that starts test runs without stopping them is refused at this limit instead of holding more ports`,
			parse: (input: string) => intOrError(input),
		},
		RUN_HOST_ID: {
			desc: `host id a standing test run takes. Its steps register here under that host and are called with \`on host {id}, <step>\` (default ${RUNNER_DEFAULTS.hostId})`,
			parse: (input: string) => intOrError(input),
		},
		RUN_PORT: {
			desc: "port a test run's own web server binds, so the test run doesn't bind the same default port as another process. The default is zero, which binds the ports the test run's features declare. A suite that asserts a default port requires zero",
			parse: (input: string) => intOrError(input),
		},
	};

	/** The test run in flight, if any. One test run is in flight at a time, since a finding about two concurrent test
	 *  runs wouldn't show which one it describes. */
	private inFlight: TTrackedRun | undefined;
	/** Every test run started since beginAsk last reset this list. MAX_RUNS caps its length. */
	private runsThisAsk: TTrackedRun[] = [];
	/** The last test run this stepper started, kept across beginAsk resets. An operator's question about a test often
	 *  follows the exchange that started it, so askTestRun selects this test run where it doesn't track a newer one,
	 *  instead of stating that a test run wasn't started. */
	private lastRun: TTrackedRun | undefined;
	/** The record of the last start attempt that failed, cleared by a start that succeeds. A step that doesn't find a
	 *  test run reports that failure from it. */
	private notStarted: TFeatureExecution | undefined;
	/** Standing test runs by id. Each holds its port after its features finish, until it is stopped. */
	private standing = new Map<string, TTrackedRun>();
	private principalWritten = new WeakSet<object>();
	/** Actuality's steppers. The agent's tools are their steps, called by name. */
	steppers: AStepper[] = [];

	async setWorld(world: TWorld, steppers: AStepper[]): Promise<void> {
		await super.setWorld(world, steppers);
		this.steppers = steppers;
	}

	steps = {
		runTest: {
			gwta: `run the tests in {where: ${DOMAIN_FILE_PATH}} matching {filter: ${RUN_DOMAIN.featureFilter}}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description:
				"Start a test run of the named features and record it, so later findings can reference it. The products are that record: its id, and its endpoint and host where the test run stands. One test run at a time: a start while a test run is in flight is refused with the id of that test run. Features that ran against the present state of their dependencies don't run again until a dependency changes or a caller notes a change.",
			// The products are the test run's first record, so `feature-execution` is a goal. Resolving it selects this
			// step as the michi, so the resolver offers starting a test run as a step.
			productsDomain: FEATURE_EXECUTION_DOMAIN,
			action: async ({ where, filter }: { where: string; filter: string }) => await this.askedToRun(where, filter),
		},
		runAllTests: {
			gwta: `run all the tests in {where: ${DOMAIN_FILE_PATH}}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			description:
				"Start a test run of every feature in a directory. The products are its record. The limits of a filtered test run apply: one at a time, and not again until a dependency of the features changes.",
			productsDomain: FEATURE_EXECUTION_DOMAIN,
			action: async ({ where }: { where: string }) => await this.askedToRun(where, ""),
		},
		readTestRun: {
			gwta: `read the test run`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Read the output of the test run in flight since the last read, and its status. This step closes the test run's record and clears the test run in flight when the test run has exited or its execution has ended, so the next test run can start. The status comes from the exit code, or from the execution's status of a standing test run.",
			productsDomain: DOMAIN_TEST_RUN_READ,
			action: async () => {
				const tracked = this.inFlight;
				if (!tracked) return actionNotOK(this.nothingToRead("read"));
				const read = await this.callSupervisor(runReadSchema, SUPERVISOR.read, { run: tracked.id, cursor: tracked.cursor });
				if (read.ok === false) return actionNotOK(read.why);
				const { status, exitCode, cursor, output } = read.products;
				tracked.cursor = cursor;
				tracked.reported = read.products;
				const { execution } = read.products;
				if (status === "ended" || isLevelEnd(execution)) {
					await this.finishRun(exitCode, status === "ended" || !isLevelEnd(execution) ? undefined : statusOfExecution(execution));
					await this.recordOutcome(tracked);
				}
				return actionOKWithProducts({ run: tracked.id, status, exitCode: exitCode ?? null, output });
			},
		},
		awaitTestRun: {
			gwta: `wait until the test run ends within {seconds: number} seconds`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Wait for the test run in flight to end, and return its status and the end of its output. The supervisor responds when the test run exits or its features finish, so this is one call for any duration. A test run that doesn't pass fails this step with its last output. The wait is bounded: reaching the limit fails the step with the seconds waited, so a test run that hangs fails this step and doesn't block the process.",
			productsDomain: DOMAIN_TEST_RUN_READ,
			action: async ({ seconds }: { seconds: number }) => {
				const tracked = this.inFlight;
				if (!tracked) return actionNotOK(this.nothingToRead("await"));
				// The supervisor holds the child process and responds when the test run ends, so this step doesn't poll.
				const waited = await this.callSupervisor(runReadSchema, SUPERVISOR.wait, { run: tracked.id, seconds, cursor: tracked.cursor });
				if (waited.ok === false) return actionNotOK(waited.why);
				const seen = waited.products;
				tracked.cursor = seen.cursor;
				tracked.reported = seen;
				const said = lastOf(seen.output);
				// A standing test run's execution ends and its process keeps serving, so it is done without an exit. Its status then
				// comes from its execution's status, not from an exit code.
				const { execution } = seen;
				if (seen.status !== "ended" && !isLevelEnd(execution))
					return actionNotOK(`the test run "${tracked.filter}" had not ended after ${seconds} seconds; read it or stop it instead of waiting again`);
				const status = seen.status === "ended" || !isLevelEnd(execution) ? statusOfExit(seen.exitCode) : statusOfExecution(execution);
				// finishRun reads the status from the exit code only for a test run that exited.
				await this.finishRun(seen.exitCode, seen.status === "ended" ? undefined : status);
				await this.recordOutcome(tracked);
				// A test run that doesn't pass fails this step. An OK result would report a passing suite for a test run
				// that didn't collect a feature.
				if (status !== RUN_STATUS.completed)
					return actionNotOK(`the test run "${tracked.filter}" ${status} (exit ${seen.exitCode}); examine it with TestRunnerStepper-examineTestRun. Its last output:\n${said}`);
				return actionOKWithProducts({ run: tracked.id, status, exitCode: seen.exitCode ?? null, output: said });
			},
		},
		examineTestRun: {
			gwta: `examine the test run`,
			capability: SUPERVISOR_CAPABILITIES.read,
			description:
				"Examine the test run in flight or else the last test run started since beginAsk: its summary, each step it recorded as failed with the seqPath of the failure, and the path of its report. Each field comes from the test run's own output. Output formatted for a person doesn't carry step events, so its feature and step counts are zero, and the summary and the report show the outcome. The report path is written to the test run's record, so a later reader finds it there.",
			productsDomain: DOMAIN_TEST_RUN_EXAMINED,
			action: async () => {
				const tracked = this.inFlight ?? this.runsThisAsk.at(-1);
				if (!tracked) return actionNotOK(this.nothingToRead("examine"));
				const read = await this.callSupervisor(runReadSchema, SUPERVISOR.read, { run: tracked.id, cursor: 0 });
				if (read.ok === false) return actionNotOK(read.why);
				const { output } = read.products;
				tracked.reported = read.products;
				await this.recordOutcome(tracked);
				// The failed steps come from the output tail that the supervisor keeps. The supervisor accrued the counts from
				// the whole output as it arrived.
				const { failures } = examineRun(output);
				return actionOKWithProducts({
					run: tracked.id,
					summary: read.products.summary,
					failures,
					report: read.products.report,
					steps: read.products.steps,
					features: read.products.features,
				});
			},
		},
		askTestRun: {
			gwta: `ask the test run to {method: ${DOMAIN_ASKED_STEP}} with {params: ${DOMAIN_ASKED_PARAMS}}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			// Offered to a model only after a test run has started. A model offered it earlier calls it on a test run that
			// doesn't exist instead of starting one.
			offeredBeforeDiscovery: () => this.startedARun(),
			description:
				"Call one of the standing test run's own steps by its method name on the test run's host. Calling showSteps on that host returns those names, and a wrong name fails with names that host registers. The step runs on the test run under the same capability check as any step, and returns what the test run holds, not what actuality holds. Parameters are name=value pairs or JSON. A step that takes one parameter also accepts a bare value or a bare object, and an object parameter accepts its JSON text. Use this for each question about the test and not about actuality. Every other step reads from actuality.",
			// A model receives the `text` product of a tool call, so `text` holds the summary. `answer` holds the full
			// response and a listing's entries for a caller that requests them.
			productsDomain: DOMAIN_TEST_RUN_ANSWER,
			action: async ({ method, params }: { method: string; params: string }) => {
				const tracked = this.inFlight ?? [...this.standing.values()].at(-1) ?? this.runsThisAsk.at(-1) ?? this.lastRun;
				if (!tracked)
					return actionNotOK(
						"a test run hasn't been started here, so askTestRun can't call a step; start one first with TestRunnerStepper-runTest or TestRunnerStepper-runAllTests",
					);
				// A test run that doesn't stand or has ended doesn't register steps here, and the store holds its record. A
				// message that states a test run wasn't started would be false, so this message names the steps that read it.
				if (!tracked.host || (!this.inFlight && !this.standing.has(tracked.id)))
					return actionNotOK(
						`the test run "${tracked.filter}" in "${tracked.where}" doesn't stand or is no longer up, so askTestRun can't call its steps; examine it with TestRunnerStepper-examineTestRun, or read its record in a list of "${FEATURE_EXECUTION_LABEL}"`,
					);
				const atRun = this.stepsAtRun(tracked.host);
				const target = stepAtRun(atRun, tracked.host, unquote(method));
				const scoped = target?.method ?? hostScopedMethodName(tracked.host, unquote(method));
				if (atRun.length && !target)
					return actionNotOK(
						`the test run at host ${tracked.host} doesn't register a step named ${method}. ${recipeAtRun(atRun)}Its steps include ${atRun
							.map((step) => bareMethodName(step.method))
							.slice(0, 12)
							.join(", ")}`,
					);
				const takes = (target?.inputSchema.properties === undefined ? [] : Object.keys(target?.inputSchema.properties));
				const given = askParams(params, target?.inputSchema.properties);
				// A step called without a required parameter fails inside the test run with a message that appears to describe
				// a fault of the test run. This message names the step's own parameters so the caller can correct the call.
				const missing = (target?.inputSchema.required ?? takes).filter((name) => given[name] === undefined);
				if (missing.length)
					return actionNotOK(
						`${method} at host ${tracked.host} takes ${takes.join(", ")}, and ${Object.keys(given).length > 0 ? `was given ${Object.keys(given).join(", ")}` : "wasn't given a parameter"}: ${missing.map((name) => `${name}${whatItTakes(target?.inputSchema.properties[name])}`).join(", ")} missing`,
					);
				const asked = await this.callSupervisor(z.object({}).passthrough(), scoped, given);
				// This message states that the test run is up and includes the reason for the refusal. A model treats a bare
				// refusal as an unreachable test run and calls steps on the wrong instance. `list: "Step" is not a declared type`
				// is one such refusal.
				if (asked.ok === false) return actionNotOK(`the test run at host ${tracked.host} refused ${method}, so it is up: ${asked.why}`);
				return actionOKWithProducts({ run: tracked.id, host: String(tracked.host), method, ...answerOfRun(asked.products) });
			},
		},
		noteSourceChanged: {
			gwta: `note that {filter: ${RUN_DOMAIN.featureFilter}} in {where: ${DOMAIN_FILE_PATH}} has changed`,
			description:
				"Note that a change was applied to the named features, so they run again whatever their dependencies show. The supervisor refuses a test run of features against their present state until their state changes or a caller notes a change, since that test run would repeat the last outcome whether it passed or failed.",
			action: ({ filter, where }: { filter: string; where: string }) => {
				this.noteApplied(filter, where);
				return Promise.resolve(actionOK());
			},
		},
		noteEverythingChanged: {
			gwta: `note that the tests in {where: ${DOMAIN_FILE_PATH}} have changed`,
			description: "The same note for a test run of every feature in a base. It has its own line because an empty argument doesn't name every feature.",
			action: ({ where }: { where: string }) => {
				this.noteApplied("", where);
				return Promise.resolve(actionOK());
			},
		},
		stopTestRun: {
			gwta: `stop the test run`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			description:
				"End the test run in flight or else the last standing test run, and release its port. A standing test run holds its port after its features finish, so stop it when the caller doesn't have another step to call on it.",
			action: async () => {
				// A test run whose features have finished can still stand and hold its port for askTestRun. Stopping ends it,
				// so this step also stops a standing test run that isn't in flight.
				const tracked = this.inFlight ?? [...this.standing.values()].at(-1);
				if (!tracked) return actionNotOK("a test run isn't in flight or standing, so this step doesn't have a test run to stop");
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

	/** Starts a test run for runTest and runAllTests, and checks the limits for both. An empty filter runs every feature
	 *  of the base. */
	private async askedToRun(where: string, filter: string) {
		if (this.inFlight)
			return actionNotOK(`a test run is already in flight: "${this.inFlight.filter}" (${this.inFlight.id}); read it or wait for it to end before starting another`);
		const standingCap = this.cap("MAX_STANDING", RUNNER_DEFAULTS.maxStanding);
		if (this.runStands() && this.standing.size >= standingCap)
			return actionNotOK(`${this.standing.size} standing test runs reach MAX_STANDING: stop one of ${[...this.standing.keys()].join(", ")} before starting another`);
		if (this.runsThisAsk.length >= this.cap("MAX_RUNS", RUNNER_DEFAULTS.maxRuns))
			return actionNotOK(`the MAX_RUNS limit is reached after ${this.runsThisAsk.length} test runs; report the findings instead of starting another test run`);
		// The supervisor refuses a test run of features that already ran against their present state. The supervisor
		// holds the outcome record, so a change since that test run is read from the features' dependencies, not held here.
		const run = await this.startRun(where, filter);
		if ("why" in run) {
			// The failure is written as a record, so a reader finds the test run that didn't start. The steps that follow
			// return the failure through nothingToRead, so a caller doesn't search for a failure it already received.
			const startedAt = new Date().toISOString();
			const attempt = { id: runId(filter, startedAt), filter, where, cursor: 0, status: RUN_STATUS.notStarted, startedAt, endpoint: "", host: 0 };
			this.notStarted = await this.writeRun({ ...attempt, attributedTo: this.actingPrincipal(), askedIn: askedIn() }, { why: run.why });
			return actionNotOK(run.why);
		}
		this.notStarted = undefined;
		// The products are the test run's record. The goal resolver asserts it as the satisfied `feature-execution`, and a
		// caller reads the id, endpoint and host from it. A standing test run is addressed by its host
		// (`on host {host}, <step>`). A test run that ends with its features doesn't carry a host.
		return actionOKWithProducts(run.record);
	}

	/** Returns the message for a step that doesn't find a test run. The message includes the failure of the last start
	 *  attempt where one failed, so the caller receives the cause and not only its effect. */
	private nothingToRead(what: string): string {
		const why = this.notStarted?.why;
		return why
			? `this step doesn't have a test run to ${what}, because the last one didn't start: ${why}`
			: `this step doesn't have a test run to ${what}; start one with TestRunnerStepper-runTest or TestRunnerStepper-runAllTests`;
	}

	/** Whether this stepper has a test run for askTestRun: one in flight, one standing, or an earlier one whose record
	 *  remains. */
	private startedARun(): boolean {
		return !!(this.inFlight ?? [...this.standing.values()].at(-1) ?? this.runsThisAsk.at(-1) ?? this.lastRun);
	}

	/** Returns the steps this process's registry holds under a standing test run's host: the steps its transport injected,
	 *  with their input schemas. An empty list means the transport didn't inject steps, so askTestRun sends the call as
	 *  written. */
	private stepsAtRun(host: number): TStepDescriptor[] {
		return runRegistry(this.getWorld())
			.descriptors()
			.filter((step) => hostOfMethodName(step.method) === host);
	}

	/** Calls a supervisor step or a standing test run's step, and parses its products with the given schema, so a wrong
	 *  shape fails here. callStepFrom throws with the name of the missing step in a process that doesn't load InstanceStepper. */
	private async callSupervisor<S extends z.ZodTypeAny>(
		schema: S,
		method: string,
		input: Record<string, unknown>,
	): Promise<{ ok: true; products: z.infer<S> } | { ok: false; why: string }> {
		const called = await callStepFrom(this, method, input);
		if (!called.result.ok) return { ok: false, why: `${method}: ${called.result.errorMessage}` };
		const parsed = schema.safeParse(called.result.products ?? {});
		if (!parsed.success) return { ok: false, why: `${method} returned products that don't match its declared schema: ${parsed.error.message}` };
		return { ok: true, products: parsed.data as z.infer<S> };
	}

	/** Returns the option's value from the environment, or the fallback. This function throws on an invalid value, so a
	 *  misconfigured limit doesn't leave the agent unbounded. */
	private cap(option: "MAX_RUNS" | "MAX_STANDING" | "RUN_PORT" | "RUN_HOST_ID", fallback: number, { zeroMeans }: { zeroMeans?: string } = {}): number {
		const configured = getStepperOption(this, option, this.getWorld().moduleOptions);
		if (configured === undefined) return fallback;
		const parsed = Number(configured);
		const floor = zeroMeans ? 0 : 1;
		if (!Number.isInteger(parsed) || parsed < floor)
			throw new Error(`${option} must be a whole number ${zeroMeans ? `of at least zero, where zero means ${zeroMeans}` : "of at least one"}, not "${configured}"`);
		return parsed;
	}

	/** Whether a test run started now stands after its features finish. */
	private runStands(): boolean {
		const configured = getStepperOption(this, "RUN_STANDS", this.getWorld().moduleOptions);
		return configured === undefined ? false : Boolean(boolOrError(String(configured)).result);
	}

	/** Returns the attribution for a test run started now: the principal that the call's boundary verified, or this
	 *  agent's Principal where the call didn't present a proof. */
	private actingPrincipal(): string {
		return actingAs() ?? TEST_RUNNER_AUTHOR;
	}

	/** Writes the agent's Principal once per store, so each finding it writes is attributed to a record. */
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

	/** Starts a test run through the supervisor and records it as an individual, so a finding can reference it. */
	private async startRun(where: string, filter: string): Promise<{ ok: true; record: TFeatureExecution } | { ok: false; why: string }> {
		await this.ensureAgentPrincipal();
		const port = this.cap("RUN_PORT", RUNNER_DEFAULTS.port, { zeroMeans: "the ports the test run's features declare" });
		const stands = this.runStands();
		if (stands && port === 0) return { ok: false, why: "a standing test run requires a port: set RUN_PORT, or turn RUN_STANDS off" };
		const startedAt = new Date().toISOString();
		const id = runId(filter, startedAt);
		// Only a standing test run serves after its features finish, so only it has an endpoint to record.
		const endpoint = stands ? localOrigin(port) : "";
		const from = (getStepperOption(this, "RUN_FROM", this.getWorld().moduleOptions) as string | undefined) ?? where;
		// A standing test run takes a host id, and later calls address it by that id. A test run that ends with its features
		// doesn't take one.
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

	/** Writes the test run's record with the fields `extra` adds, and returns it. One function builds the record, so a
	 *  field added to a FeatureExecution is added in one place. runTest returns the record as its products, so the
	 *  resolver reaches `feature-execution` as a goal through runTest. */
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
	 * Writes the test run's outcome to its record: its feature and step counts, its failed step count, its first failure
	 * and its report path. A reader of the record then has the outcome without the products of an earlier examineTestRun.
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

	/** Deletes the recorded outcomes of the named features, so they run again whatever their state. A caller notes a
	 *  change that doesn't show in the features' dependencies, or notes one to require another test run regardless. An
	 *  empty filter selects every feature of the base. */
	noteApplied(filter: string, where: string): void {
		forgetOutcomes(path.resolve(where), filter || undefined);
	}

	/** Closes the record of the test run in flight with its status, and clears the test run in flight so the next one
	 *  can start. The status comes from `ended` where it is given, else from the exit code. A standing test run whose
	 *  features finished hasn't exited, so its caller passes `ended`. */
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

	/** Resets the count MAX_RUNS caps. The cap then bounds the test runs started since this call, not those of the whole
	 *  process. */
	beginAsk(): void {
		this.runsThisAsk = [];
	}

	/** The number of test runs counted against MAX_RUNS, and the id of the test run in flight. Tests read it. */
	usage(): { runs: number; inFlight: string | undefined } {
		return { runs: this.runsThisAsk.length, inFlight: this.inFlight?.id };
	}
}
