/**
 * Tests the test-runner agent's limits, the principal it starts each test run as, and the functions that read a test run's output.
 * The code enforces the limits, so they don't depend on the model's response. The agent allows one test run in flight
 * at a time. MAX_RUNS caps the test runs started between beginAsk calls. A start past that cap is refused with a message
 * that states the limit is reached. The supervisor refuses a test run of features that already ran against their present
 * state. noteApplied deletes the record of those test runs, so the features run again.
 *
 * The store is an in-memory QuadStore. The tests assert the agent's own bookkeeping and the Principal it writes. The
 * supervisor's tests assert the records of a test run's levels. They don't test a graph engine. A consumer's agent feature tests the agent loop against a live model.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper, { RUNNER_DEFAULTS, TEST_RUNNER_AUTHOR } from "./test-runner-stepper.js";
import { answerOfRun, askParams, stepAtRun } from "./test-runner-stepper.js";
import type { TStepDescriptor } from "@haibun/core/lib/step-discovery.js";
import { emptyOutcome, readRunOutput, runEvents } from "./pipelines/run-outcome.js";
import { RECORDED_STATUS } from "@haibun/core/lib/domains/protocol.js";
import { actingAs } from "@haibun/core/lib/domains/capability-context.js";
import { Access, principalDomainDefinition } from "@haibun/core/lib/domains/resources.js";
import { readAction } from "@haibun/core/lib/domains/actions.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains/domains.js";
import { AStepper, type IHasCycles, type IStepperCycles } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/domains/util.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { addStepperConcerns } from "@haibun/core/phases/Executor.js";
import { hostScopedMethodName } from "@haibun/core/lib/steps/domains/step-method.js";
import { openRunRegistry, runRegistry } from "@haibun/core/lib/step-registry.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import { QuadStore, newStoreChain } from "@haibun/core/lib/quad-store.js";
import nodeFS from "node:fs";
import os from "node:os";
import path from "node:path";
import { ACTUALITIES_FILE } from "@haibun/core/lib/adapters/dependency-state.js";
import { RUN_AUTHORITY, runAuthorizedWith } from "@haibun/core/lib/domains/capability-context.js";
import { RUN_DOMAIN, SUPERVISOR_CAPABILITIES, runDomainDefinitions } from "./domains/run.js";

type TResult = { ok: boolean; errorMessage?: string; products?: { run: string; status: string; record: string } };

/** A run's outcome from its whole output, as the supervisor accrues it chunk by chunk. */
const outcomeOf = (output: string) => {
	const outcome = emptyOutcome();
	readRunOutput(outcome, `${output}\n`);
	return outcome;
};

/** Test double for the CLI's run supervisor. Its class name matches the stepper name the agent calls. Its steps require
 *  the same capabilities as the real supervisor's steps. The agent calls it by dispatching a step, so the tests exercise
 *  the call the real supervisor handles, not an entry point added for the test. It returns fixed output and a fixed
 *  cursor, so each read is deterministic. */
class InstanceStepper extends AStepper implements IHasCycles {
	description = "A test double for the run supervisor. Its steps return fixed output.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: runDomainDefinitions }) };
	calls: Array<{ step: string; input: Record<string, unknown>; actingAs?: string }> = [];
	ended: number | null = null;
	/** The output the test run has logged. A test run writes its events to its output. The agent reads the events from that output. */
	output = "a line of output";
	/** The reason the supervisor refuses the next start, as it refuses features that ran against their present dependencies. */
	refusal: string | undefined;
	steps = {
		startRun: {
			gwta: `start a haibun run of {where} matching {filter} from {from} on port {port: number} as run {run} host {hostId: number}`,
			capability: SUPERVISOR_CAPABILITIES.run,
			productsDomain: RUN_DOMAIN.started,
			action: (input: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				this.calls.push({ step: "startRun", input, actingAs: actingAs() });
				if (this.refusal !== undefined) return Promise.resolve(actionNotOK(this.refusal));
				return Promise.resolve(actionOKWithProducts({ run: input.run, where: input.where, filter: input.filter, record: "1700000000000-0" }));
			},
		},
		readRun: {
			gwta: `read the haibun run {run} since {cursor: number}`,
			capability: SUPERVISOR_CAPABILITIES.read,
			productsDomain: RUN_DOMAIN.read,
			action: (input: { run: string; cursor: number }) => {
				this.calls.push({ step: "readRun", input });
				const status = this.ended === null ? "running" : "ended";
				// The real supervisor moves the actuality machine with a test run's events as its output arrives. This double reads fixed output.
				const { actuality, report } = outcomeOf(this.output);
				return Promise.resolve(
					actionOKWithProducts({
						run: input.run,
						status,
						exitCode: this.ended,
						cursor: 12,
						output: this.output,
						dropped: 0,
						features: actuality.features.length,
						execution: actuality.status,
						steps: actuality.steps,
						failures: actuality.failures,
						...(report === undefined ? {} : { report }),
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
	const store = new QuadStore(newStoreChain());
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

	it("clears the state of every actuality of a base's features when a change to every feature is noted, so the features run again in any state", () => {
		const dir = nodeFS.mkdtempSync(path.join(os.tmpdir(), "haibun-noted-"));
		const actuality = { state: "s", filter: "", execution: { text: "an actuality", status: "passed", tookMs: 0 }, features: {} };
		nodeFS.writeFileSync(path.join(dir, ACTUALITIES_FILE), JSON.stringify({ machine: { conditions: actuality } }));
		h.stepper.noteApplied("", dir);
		expect(JSON.parse(nodeFS.readFileSync(path.join(dir, ACTUALITIES_FILE), "utf-8")).machine.conditions.state, "the supervisor doesn't refuse the test run").toBeUndefined();
	});

	it("refuses a test run past MAX_RUNS for an ask and states the reason", async () => {
		for (const filter of ["one", "two", "three"]) {
			expect((await h.run("tests", filter)).ok).toBe(true);
			h.stepper.finishRun();
		}
		const past = await h.run("tests", "four");
		expect(past.ok).toBe(false);
		expect(past.errorMessage).toMatch(/MAX_RUNS limit is reached/);
	});

	it("counts test runs against the limit until beginAsk resets the count", async () => {
		for (const filter of ["one", "two", "three"]) {
			await h.run("tests", filter);
			h.stepper.finishRun();
		}
		h.stepper.beginAsk();
		expect((await h.run("tests", "four")).ok).toBe(true);
	});
});

describe("who a test run names as its starter", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("starts the test run as the agent where the call didn't verify a principal, so the run's record names the agent", async () => {
		const started = await h.run("tests", "polymorphic");
		expect(started.products?.record, "the products name the execution record of the test run, which a finding can reference").toBe("1700000000000-0");
		expect(h.supervisor.calls.find((c) => c.step === "startRun")?.actingAs, "the supervisor writes the run's record as the principal that started it").toBe(TEST_RUNNER_AUTHOR);
		expect(
			h.written.some((w) => w.data.id === TEST_RUNNER_AUTHOR),
			"the agent writes its own Principal, so the attribution references a record",
		).toBe(true);
	});

	it("fails a start the supervisor refuses with why, and a later read returns that cause", async () => {
		const why = "start run: every feature in tests passed against its present dependencies";
		h.supervisor.refusal = why;
		const refused = await h.run("tests", "");
		const refusedAs = `InstanceStepper-startRun: ${why}`;
		expect(refused.errorMessage, "the refusal names the supervisor's step that refused").toBe(refusedAs);
		expect((await h.read()).errorMessage).toBe(`this step doesn't have a test run to read, because the last one didn't start: ${refusedAs}`);
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
		expect(started.ok).toBe(true);
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
		expect(waited.products?.status).toBe(RECORDED_STATUS.completed);
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

	it("clears the test run in flight once it has ended, so the next one can start", async () => {
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 1;
		await h.read();
		expect(h.stepper.usage().inFlight).toBeUndefined();
	});

	it("stops a test run through the supervisor, which records its levels as stopped", async () => {
		await h.run("tests", "polymorphic");
		expect((await h.stop()).ok).toBe(true);
		expect(h.supervisor.calls.some((c) => c.step === "stopRun")).toBe(true);
		expect(h.stepper.usage().inFlight).toBeUndefined();
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
		'{"id":"0.1.1.1","timestamp":1,"kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"set answer to ready"}',
		'{"id":"0.1.1.2","timestamp":2,"kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"variable answer is other","error":"answer is ready, not other"}',
		'{"id":"log.1","kind":"log","level":"info","message":"shu standalone report: file:///tmp/capture/featn-1/shu.html"}',
		'{"id":"execution","timestamp":3,"kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
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
		const { actuality } = outcomeOf(OUTPUT);
		expect(actuality.steps).toBe(2);
		expect(actuality.failures).toEqual([{ id: "0.1.1.2", step: "variable answer is other", message: "answer is ready, not other" }]);
	});

	it("reads the report path from the artifact event, or else from the test run's log line", () => {
		expect(outcomeOf('{"kind":"artifact","artifactType":"html","path":"file:///tmp/capture/one/shu.html"}').report).toBe("file:///tmp/capture/one/shu.html");
		expect(outcomeOf(OUTPUT).report, "a log line holds the path when an artifact event doesn't").toBe("file:///tmp/capture/featn-1/shu.html");
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

describe("examining a finished test run", () => {
	it("returns how it ended, its counts and its failed steps, as the supervisor read them from every event", async () => {
		const h = harness();
		h.stepper.beginAsk();
		await h.run("tests", "polymorphic");
		h.supervisor.ended = 1;
		h.supervisor.output = [
			'{"id":"feat-1","timestamp":1,"kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"id":"feat-1","timestamp":1,"kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"id":"0.1.1.1","timestamp":2,"kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"a step"}',
			'{"id":"0.1.1.2","timestamp":3,"kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"another","error":"it logged no"}',
			'{"id":"feat-1","timestamp":4,"kind":"lifecycle","stage":"end","status":"failed","type":"feature"}',
			'{"id":"execution","timestamp":5,"kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
		].join("\n");
		await h.waitFor(30);
		const examined = await h.asRun(() => (h.stepper.steps.examineTestRun.action as () => Promise<TResult & { products?: Record<string, unknown> }>)());
		expect(examined.products, "a feature reported twice is one feature").toMatchObject({
			status: RECORDED_STATUS.failed,
			steps: 2,
			features: 1,
			failures: [{ id: "0.1.1.2", step: "another", message: "it logged no" }],
		});
	});

	describe("running a test as a goal", () => {
		it("resolves run-started to the steps that start a test run, so the resolver offers running a test as a step and not only as prose", async () => {
			// The started test run is the step's declared product, so the goal graph holds a producer edge to it. Resolving
			// `run-started` returns runTest or runAllTests as the plan. The resolver selects the step by its declared
			// product and not by a naming convention.
			const { producerRules, stepSignatures } = await import("@haibun/logic/derivations/goals.js");
			const { logicEngine } = await import("@haibun/logic/root.js");
			const { proved } = await import("@haibun/logic/pipelines/prove.js");
			const domains = mapDefinitionsToDomains(runDomainDefinitions);
			const signatures = stepSignatures([new TestRunnerStepper() as never]);
			const producers = signatures.filter((one) => one.outputDomains.includes(RUN_DOMAIN.started)).map((one) => one.stepName);
			expect(producers, "both steps that start a test run produce the record").toEqual(expect.arrayContaining(["runTest", "runAllTests"]));
			const ended = await proved(await logicEngine(), `goals(${producerRules(signatures, domains, ["Instance:run"])}, ['${RUN_DOMAIN.started}'])`, () =>
				Promise.resolve("facts([[]])"),
			);
			expect(
				("goals" in ended ? ended.goals : []).flatMap((proof) => proof.plans.map((plan) => ("do" in plan ? plan.do : ""))),
				"the engine proves the goal with a plan",
			).toContain("TestRunnerStepper-runTest");
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
