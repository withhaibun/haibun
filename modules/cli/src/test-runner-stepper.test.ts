/**
 * Tests the test-runner agent's limits, the record it writes for each test run, and the functions that read a test run's output.
 * The code enforces the limits, so they don't depend on the model's response. The agent allows one test run in flight
 * at a time. MAX_RUNS caps the test runs started between beginAsk calls. A start past that cap is refused with a message
 * that states the limit is reached. The supervisor refuses a test run of features that already ran against their present
 * state. noteApplied deletes the record of those test runs, so the features run again.
 *
 * The store is an in-memory QuadStore. The tests assert the agent's own bookkeeping and the record it writes for each
 * test run. They don't test a graph engine. A consumer's agent feature tests the agent loop against a live model.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper, { RUNNER_DEFAULTS, TEST_RUNNER_AUTHOR } from "./test-runner-stepper.js";
import { answerOfRun, askParams, stepAtRun } from "./test-runner-stepper.js";
import type { TStepDescriptor } from "@haibun/core/lib/step-discovery.js";
import { examineRun, runEvents } from "./run-outcome.js";
import { FEATURE_EXECUTION_LABEL, RUN_STATUS, featureExecutionDomainDefinition } from "./feature-execution.js";
import { Access, principalDomainDefinition } from "@haibun/core/lib/resources.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { AStepper, type IHasCycles, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { addStepperConcerns } from "@haibun/core/phases/Executor.js";
import { hostScopedMethodName, openRunRegistry, runRegistry } from "@haibun/core/lib/step-registry.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERIFIED_FILE } from "@haibun/core/lib/util/node/dependency-state.js";
import { RUN_AUTHORITY, runAuthorizedWith } from "@haibun/core/lib/capability-context.js";
import { RUN_DOMAIN, SUPERVISOR_CAPABILITIES, runDomainDefinitions } from "./instance-stepper.js";

type TResult = { ok: boolean; errorMessage?: string; products?: { run: string; status: string; endpoint: string } };

/** Test double for the CLI's run supervisor. Its class name matches the stepper name the agent calls. Its steps require
 *  the same capabilities as the real supervisor's steps. The agent calls it by dispatching a step, so the tests exercise
 *  the call the real supervisor handles, not an entry point added for the test. It returns fixed output and a fixed
 *  cursor, so each read is deterministic. */
class InstanceStepper extends AStepper implements IHasCycles {
	description = "A test double for the run supervisor. Its steps return fixed output.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: runDomainDefinitions }) };
	calls: Array<{ step: string; input: Record<string, unknown> }> = [];
	ended: number | null = null;
	/** The output the test run has logged. A test run writes its events to its output. The agent reads the events from that output. */
	output = "a line of output";
	steps = {
		startRun: {
			gwta: `start a haibun run of {where} matching {filter} from {from} on port {port: number} as run {run} host {hostId: number}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			productsDomain: RUN_DOMAIN.started,
			action: (input: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				this.calls.push({ step: "startRun", input });
				return Promise.resolve(actionOKWithProducts({ run: input.run, where: input.where, filter: input.filter }));
			},
		},
		readRun: {
			gwta: `read the haibun run {run} since {cursor: number}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			productsDomain: RUN_DOMAIN.read,
			action: (input: { run: string; cursor: number }) => {
				this.calls.push({ step: "readRun", input });
				const status = this.ended === null ? "running" : "ended";
				// The real supervisor accrues a test run's outcome from its output as the output arrives. This double computes the same products from fixed output.
				const outcome = examineRun(this.output);
				const [first] = outcome.failures;
				return Promise.resolve(
					actionOKWithProducts({
						run: input.run,
						status,
						exitCode: this.ended,
						cursor: 12,
						output: this.output,
						dropped: 0,
						features: outcome.features.length,
						finished: this.ended !== null,
						steps: outcome.steps,
						failed: outcome.failures.length,
						firstFailure: first ? `${first.seqPath}: ${first.step}${first.message ? ` (${first.message})` : ""}` : "",
						summary: outcome.summary,
						report: outcome.report,
					}),
				);
			},
		},
		waitRun: {
			gwta: `wait for the haibun run {run} to end within {seconds: number} seconds`,
			capability: SUPERVISOR_CAPABILITIES.read,
			productsDomain: RUN_DOMAIN.read,
			action: (input: { run: string; seconds: number; cursor: number }) => {
				this.calls.push({ step: "waitRun", input });
				return this.steps.readRun.action({ run: input.run, cursor: input.cursor });
			},
		},
		stopRun: {
			gwta: `stop the haibun run {run}`,
			capability: SUPERVISOR_CAPABILITIES.stop,
			productsDomain: RUN_DOMAIN.stopped,
			action: (input: { run: string }) => {
				this.calls.push({ step: "stopRun", input });
				return Promise.resolve(actionOKWithProducts({ run: input.run }));
			},
		},
	};
}

/** Builds the agent, the supervisor double and an in-memory store. The harness lists each individual the store writes,
 *  in order. The list lets the tests check the record that the agent writes for each test run. */
function harness({ supervised = true, standing = false }: { supervised?: boolean; standing?: boolean } = {}) {
	const written: Array<{ label: string; data: Record<string, unknown> }> = [];
	const stepper = new TestRunnerStepper();
	const supervisor = new InstanceStepper();
	// Wraps upsertIndividual on the framework's in-memory QuadStore to list each write in order.
	const store = new QuadStore();
	const upsert = store.upsertIndividual.bind(store);
	store.upsertIndividual = async (label: string, data: Record<string, unknown>) => {
		written.push({ label, data });
		return await upsert(label, data);
	};
	const world = getDefaultWorld();
	if (standing) world.moduleOptions = { [getStepperOptionName(stepper, "RUN_STANDS")]: "true", [getStepperOptionName(stepper, "RUN_PORT")]: "8331" };
	world.shared.getStore = () => store;
	// persistPrincipalIndividual writes the agent's Principal only where world.domains registers the Principal domain. A
	// step's products domain resolves its schema through world.domains too. The harness doesn't load the stepper that
	// declares the Principal domain, so it registers that domain here. addStepperConcerns registers the domains the
	// harness's steppers declare, as Runner does in its Concerns phase.
	world.domains = { ...world.domains, ...mapDefinitionsToDomains([principalDomainDefinition]) };
	const steppers = supervised ? [stepper, supervisor] : [stepper];
	addStepperConcerns(world, steppers);
	for (const s of steppers) void s.setWorld(world, steppers);
	// Opens the step registry with openRunRegistry, as the Executor does. A step calls another step through this registry.
	openRunRegistry(world, steppers);
	// Calls the agent's steps under RUN_AUTHORITY, as actuality calls a feature's own steps. RUN_AUTHORITY allows every
	// action, so it covers the capabilities the supervisor's steps require.
	const asRun = <T>(step: () => Promise<T>) => runAuthorizedWith(RUN_AUTHORITY, step);
	const run = (where: string, filter: string) => asRun(() => (stepper.steps.runTest.action as (a: { where: string; filter: string }) => Promise<TResult>)({ where, filter }));
	const read = () => asRun(() => (stepper.steps.readTestRun.action as () => Promise<TResult & { products?: Record<string, string> }>)());
	const stop = () => asRun(() => (stepper.steps.stopTestRun.action as () => Promise<TResult>)());
	const waitFor = (seconds: number) =>
		asRun(() => (stepper.steps.awaitTestRun.action as (a: { seconds: number }) => Promise<TResult & { products?: Record<string, string> }>)({ seconds }));
	return { stepper, supervisor, written, asRun, run, read, stop, waitFor };
}

describe("the test-runner agent's limits", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("refuses a second test run while one is in flight and names the test run in flight", async () => {
		const first = await h.run("tests", "polymorphic");
		expect(first.ok).toBe(true);
		const second = await h.run("tests", "graph-frontend");
		expect(second.ok, "the agent can't report which of two concurrent test runs failed").toBe(false);
		expect(second.errorMessage).toMatch(/already in flight: "polymorphic"/);
		expect(h.stepper.usage().runs).toBe(1);
	});

	it("deletes the record of how a base's features last ran when a change to every feature is noted, so the features run again in any state", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-noted-"));
		nodeFS.writeFileSync(path.join(dir, VERIFIED_FILE), "{}\n");
		h.stepper.noteApplied("", dir);
		expect(nodeFS.existsSync(path.join(dir, VERIFIED_FILE)), "the record is deleted, so the supervisor doesn't refuse the test run").toBe(false);
	});

	it("refuses a test run past MAX_RUNS for an ask and states the reason", async () => {
		for (const filter of ["one", "two", "three"]) {
			expect((await h.run("tests", filter)).ok).toBe(true);
			await h.stepper.finishRun(0);
		}
		const past = await h.run("tests", "four");
		expect(past.ok).toBe(false);
		expect(past.errorMessage).toMatch(/MAX_RUNS limit is reached/);
	});

	it("counts test runs against the limit until beginAsk resets the count", async () => {
		for (const filter of ["one", "two", "three"]) {
			await h.run("tests", filter);
			await h.stepper.finishRun(0);
		}
		h.stepper.beginAsk();
		expect((await h.run("tests", "four")).ok).toBe(true);
	});
});

describe("the record the agent writes for a test run", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("records the test run as an individual with its filter, status and author, so a finding can reference it", async () => {
		await h.run("tests", "polymorphic");
		const record = h.written.find((w) => w.label === FEATURE_EXECUTION_LABEL);
		expect(record?.data.filter).toBe("polymorphic");
		expect(record?.data.status).toBe(RUN_STATUS.running);
		expect(record?.data.endpoint, "the record of a test run that doesn't stand omits the endpoint instead of holding an empty one").toBeUndefined();
		expect(record?.data.attributedTo, "the record names the principal that started the test run, so the graph holds who started it").toBe(TEST_RUNNER_AUTHOR);
		expect(
			h.written.some((w) => w.data.id === TEST_RUNNER_AUTHOR),
			"the agent writes its own Principal, so the attribution references a record",
		).toBe(true);
	});

	it("closes the test run's record with the status its exit code determines, so the graph holds the outcome", async () => {
		await h.run("tests", "polymorphic");
		await h.stepper.finishRun(1);
		const last = h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1);
		expect(last?.data.status).toBe(RUN_STATUS.failed);
		expect(last?.data.endedAt).toBeDefined();
		expect(h.stepper.usage().inFlight, "a finished test run isn't in flight, so the next one may start").toBeUndefined();
	});
});

describe("following a test run", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("starts the test run through the supervisor and doesn't hold a process itself", async () => {
		const started = await h.run("tests", "polymorphic");
		const call = h.supervisor.calls.find((c) => c.step === "startRun");
		expect(call?.input, "the agent selects what runs, and the supervisor forks it").toMatchObject({
			where: "tests",
			filter: "polymorphic",
			from: "tests",
			port: RUNNER_DEFAULTS.port,
		});
		expect(RUNNER_DEFAULTS.port, "a test run uses the ports its own features declare by default").toBe(0);
		expect(started.products?.endpoint, "a test run that doesn't stand doesn't serve an endpoint after its features finish, so its record omits the endpoint").toBeUndefined();
	});

	it("fails when the test run failed, so a suite that didn't collect a feature isn't reported as passing", async () => {
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 1;
		const waited = await h.waitFor(30);
		expect(waited.ok, "the test run's exit code determines the result; a successful wait doesn't").toBe(false);
		expect(waited.errorMessage).toMatch(/failed \(exit 1\)/);
		expect(waited.errorMessage, "the message holds the test run's last output, so the failure can be examined").toContain("a line of output");
	});

	it("runs every feature in a base through runAllTests, so a caller doesn't pass an empty filter", async () => {
		await h.asRun(() => (h.stepper.steps.runAllTests.action as (a: { where: string }) => Promise<TResult>)({ where: "tests" }));
		expect(h.supervisor.calls.find((c) => c.step === "startRun")?.input.filter).toBe("");
	});

	it("follows a test run to its end within the given time and returns its status", async () => {
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 0;
		const waited = await h.waitFor(30);
		expect(waited.ok).toBe(true);
		expect(waited.products?.status).toBe(RUN_STATUS.passed);
		expect(h.stepper.usage().inFlight, "a test run followed to its end isn't in flight").toBeUndefined();
	});

	it("fails when a test run hasn't ended within the given time and doesn't wait longer", async () => {
		await h.run("tests", "polymorphic");
		const waited = await h.waitFor(0);
		expect(waited.ok).toBe(false);
		expect(waited.errorMessage).toMatch(/had not ended after 0 seconds/);
	});

	it("reads from the cursor where the last read ended, so it doesn't read the same output twice", async () => {
		await h.run("tests", "polymorphic");
		expect((await h.read()).products?.output).toBe("a line of output");
		await h.read();
		const reads = h.supervisor.calls.filter((c) => c.step === "readRun");
		expect(
			reads.map((c) => c.input.cursor),
			"the first read starts at cursor 0 and the next at the cursor the first returned",
		).toEqual([0, 12]);
	});

	it("closes the record of a test run that has ended and clears the test run in flight, so the next one can start", async () => {
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 1;
		await h.read();
		expect(h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1)?.data.status).toBe(RUN_STATUS.failed);
		expect(h.stepper.usage().inFlight).toBeUndefined();
	});

	it("records a stopped test run as stopped, since its exit code doesn't state the outcome", async () => {
		await h.run("tests", "polymorphic");
		expect((await h.stop()).ok).toBe(true);
		expect(h.supervisor.calls.some((c) => c.step === "stopRun")).toBe(true);
		expect(h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1)?.data.status).toBe(RUN_STATUS.stopped);
	});

	it("throws with the name of the missing supervisor step when InstanceStepper isn't registered, and doesn't track a test run that didn't start", async () => {
		const h = harness({ supervised: false });
		h.stepper.beginAsk();
		await expect(h.run("tests", "polymorphic")).rejects.toThrow(/"InstanceStepper-startRun" isn't a step actuality registers/);
		expect(h.stepper.usage().inFlight, "a test run that wasn't forked isn't in flight").toBeUndefined();
	});
});

describe("what a test run reports", () => {
	const OUTPUT = [
		"Haibun Monitor: /features/one.feature.ts",
		'{"id":"[0.1.1.1]","kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"set answer to ready","seqPath":[0,1,1,1]}',
		'{"id":"[0.1.1.2]","kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"variable answer is other","seqPath":[0,1,1,2],"message":"answer is ready, not other"}',
		'{"id":"log.1","kind":"log","level":"info","message":"shu standalone report: file:///tmp/capture/featn-1/shu.html"}',
		'{"id":"execution-end","kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
		"not json {",
	].join("\n");

	it("reads a test run's events from its output and skips its console prose", () => {
		const events = runEvents(OUTPUT);
		expect(events).toHaveLength(4);
		expect(
			events.every((e) => typeof e.kind === "string"),
			"a line that isn't an event isn't returned",
		).toBe(true);
	});

	it("returns the failed step with its seqPath and logged message", () => {
		const { failures, steps } = examineRun(OUTPUT);
		expect(steps).toBe(2);
		expect(failures).toEqual([{ seqPath: "0.1.1.2", step: "variable answer is other", message: "answer is ready, not other" }]);
	});

	it("reads where the test run wrote its report, so a reader finds the report from the record", () => {
		expect(examineRun(OUTPUT).report).toBe("file:///tmp/capture/featn-1/shu.html");
	});

	it("reads the test run's summary from the event that ends the execution", () => {
		expect(examineRun(OUTPUT).summary).toBe("the test run failed");
		expect(examineRun('{"kind":"lifecycle","stage":"end","status":"completed","type":"execution"}').summary).toBe("the test run completed");
	});

	it("returns a summary that states the test run didn't report an outcome", () => {
		expect(examineRun("       i █ 1.2:step-dispatch ｜ ✅ [0.1.1.1] set answer to ready\n").summary).toBe("the test run didn't report an outcome");
	});

	it("reads the report path from the artifact event, or else from the test run's log line", () => {
		expect(examineRun('{"kind":"artifact","artifactType":"html","path":"file:///tmp/capture/one/shu.html"}').report).toBe("file:///tmp/capture/one/shu.html");
		expect(examineRun(OUTPUT).report, "a log line holds the path when an artifact event doesn't").toBe("file:///tmp/capture/featn-1/shu.html");
	});
});

describe("the working directory of a test run", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("starts a base's test run in the base's directory, as the base's own command line does", async () => {
		await h.run("../tests", "polymorphic");
		expect(h.supervisor.calls.find((c) => c.step === "startRun")?.input.from, "a relative stepper path in the base's config resolves from the base").toBe("../tests");
	});
});

describe("the record of a finished test run", () => {
	it("holds the test run's counts and first failure, so a reader of the record has the outcome without another request", async () => {
		const h = harness();
		h.stepper.beginAsk();
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 0;
		h.supervisor.output = [
			'{"kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"a step","seqPath":[0,1,1,1]}',
			'{"kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"another","seqPath":[0,1,1,2],"message":"it logged no"}',
			'{"id":"feat-1","kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"id":"feat-1","kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
		].join("\n");
		await h.waitFor(30);
		const record = h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1);
		expect(record?.data.steps, "the number of steps the test run ran").toBe(2);
		expect(record?.data.features, "a feature reported twice is one feature").toBe(1);
		expect(record?.data.failed).toBe(1);
		expect(record?.data.firstFailure, "the first failure with its seqPath and message").toBe("0.1.1.2: another (it logged no)");
	});

	describe("running a test as a goal", () => {
		it("resolves feature-execution to the steps that start a test run, so the resolver offers running a test as a step and not only as prose", async () => {
			// The test run's record is the step's declared product, so the goal graph holds a producer edge to it. Resolving
			// `feature-execution` returns runTest or runAllTests as the michi. The resolver selects the step by its declared
			// product and not by a naming convention.
			const { buildDomainChain } = await import("@haibun/core/lib/domain-chain.js");
			const { resolveGoal, GOAL_FINDING } = await import("@haibun/core/lib/goal-resolver.js");
			const stepper = new TestRunnerStepper();
			const domains = mapDefinitionsToDomains([featureExecutionDomainDefinition]);
			const graph = buildDomainChain([stepper as never], domains);
			const producers = graph.edges.filter((e) => e.to === "feature-execution").map((e) => e.stepName);
			expect(producers, "both steps that start a test run produce the record").toEqual(expect.arrayContaining(["runTest", "runAllTests"]));
			const resolved = resolveGoal("feature-execution", { graph, facts: [], held: ["Instance:run"] });
			expect(resolved.finding, "the resolver returns a michi to the goal").toBe(GOAL_FINDING.MICHI);
			const steps = "michi" in resolved ? resolved.michi.flatMap((m) => m.steps.map((s) => s.stepName)) : [];
			expect(steps).toContain("runTest");
		});
	});

	describe("calling a step of a standing test run", () => {
		it("parses name=value pairs, JSON, and a bare value for a step that takes one parameter", () => {
			const text = { type: "string" };
			expect(askParams("domain=comment"), "the form a model writes").toEqual({ domain: "comment" });
			expect(askParams("perTypeLimit=300, accessLevel=private"), "several pairs with each value parsed to its type").toEqual({ perTypeLimit: 300, accessLevel: "private" });
			expect(askParams('{"domain": "comment"}'), "JSON from a caller that can write it").toEqual({ domain: "comment" });
			expect(askParams("comment", { domain: text }), "a bare value where the step takes one parameter").toEqual({ domain: "comment" });
			expect(askParams("comment", { domain: text, sort: text }), "a bare value isn't accepted where the step takes more than one parameter").toEqual({});
			expect(askParams(""), "an empty string parses to empty parameters").toEqual({});
		});

		it("parses an object parameter written bare or as JSON text", () => {
			const query = { type: "object" };
			expect(askParams('{"label": "Comment", "limit": 1}', { query }), "an object is a bare value for a step that takes one parameter").toEqual({
				query: { label: "Comment", limit: 1 },
			});
			expect(askParams('{"query": {"label": "Comment"}}', { query }), "JSON that names the parameter sets that parameter").toEqual({ query: { label: "Comment" } });
			expect(askParams('{"query": "{\\"label\\": \\"Comment\\"}"}', { query }), "an object written as JSON text parses to the object").toEqual({ query: { label: "Comment" } });
		});

		it("matches a bare step name when a single step at the host has that name", () => {
			const atHost = (stepperName: string) => ({ method: `host9_${stepperName}-listTyped`, stepperName, stepName: "listTyped" }) as TStepDescriptor;
			expect(stepAtRun([atHost("RemoteSteps")], 9, "listTyped")?.method, "a single step has that name, so it matches").toBe("host9_RemoteSteps-listTyped");
			expect(stepAtRun([atHost("RemoteSteps")], 9, "RemoteSteps-listTyped")?.method, "the full name matches too").toBe("host9_RemoteSteps-listTyped");
			expect(stepAtRun([atHost("A"), atHost("B")], 9, "listTyped"), "a name two steps share doesn't match").toBeUndefined();
		});

		it("reports the values a missing parameter takes, so a caller can send it", async () => {
			const h = harness({ standing: true });
			h.stepper.beginAsk();
			expect((await h.run("features", "")).ok, "the standing test run starts").toBe(true);
			const detail = { type: "string", enum: ["summary", "definition"] };
			const registry = runRegistry(h.stepper.getWorld());
			registry.inject([
				{
					descriptor: {
						method: hostScopedMethodName(9, "Haibun-showSteps"),
						stepperName: "Haibun",
						stepperDescription: "the test run's own steps",
						stepName: "showSteps",
						pattern: "show steps matching {text: string} as {detail: step-detail}",
						paramDomains: { text: "string", detail: "step-detail" },
						capability: readAction(Access.private),
						read: true,
						fallback: false,
						answersTheTurn: false,
						remoteOrigin: "http://localhost:8331",
						inputSchema: { type: "object", properties: { text: { type: "string" }, detail }, required: ["text", "detail"] },
					},
					paramDomainKeys: new Map(),
					transport: "remote",
					isAsync: true,
					handler: () => Promise.resolve(actionOKWithProducts({})),
				},
			]);
			const asked = (await (h.stepper.steps.askTestRun.action as (a: { method: string; params: string }) => Promise<TResult>)({
				method: "showSteps",
				params: "text=GraphStepper-",
			})) as TResult & { errorMessage?: string };
			expect(asked.errorMessage).toContain("detail (one of summary, definition) missing");
		});

		it("returns a summary in `text` for a model and the full response with its entries in `answer`", () => {
			const asked = answerOfRun({ vertices: [{ id: "cmt-1" }], total: 1 });
			expect(asked.text, "`text` puts the non-array fields first and replaces each array with its length").toBe(
				'{"total":1,"vertices":"1 entries; read one through TestRunnerStepper-askTestRun"}',
			);
			expect(asked.answer, "`answer` holds the entries for a caller that requests them").toBe('{"total":1,"vertices":[{"id":"cmt-1"}]}');
			const shown = answerOfRun({ detail: "summary", steps: [{ method: "GraphStepper-listTyped" }] });
			expect(shown.text, "a step listing doesn't have a total, so its text keeps its entries").toBe('{"detail":"summary","steps":[{"method":"GraphStepper-listTyped"}]}');
			const long = answerOfRun({ total: 40, vertices: Array.from({ length: 500 }, (_, at) => ({ id: `cmt-${at}`, body: "x".repeat(40) })) });
			expect(long.answer, "an `answer` longer than ANSWER_LIMIT ends with its full length in characters").toMatch(/characters in all\)$/);
		});
	});
});
