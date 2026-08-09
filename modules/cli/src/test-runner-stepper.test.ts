/**
 * What the test-runner agent will NOT do. The limits are the part that has to hold by construction rather than by
 * the model behaving: one run in flight, no re-run of unchanged features, and a spent budget that says so.
 *
 * The store is in memory; what is asserted here is the agent's own bookkeeping and the record it writes for a run,
 * not
 * a graph engine. The loop and the model live in the dedicated agent feature, where an ask reaches a real model.
 */
import { describe, expect, it, beforeEach } from "vitest";
import TestRunnerStepper, { RUNNER_DEFAULTS, TEST_RUNNER_AUTHOR } from "./test-runner-stepper.js";
import { answerOfRun, askParams, stepAtRun } from "./test-runner-stepper.js";
import { examineRun, runEvents } from "./run-outcome.js";
import { FEATURE_EXECUTION_LABEL, RUN_STATUS, featureExecutionDomainDefinition } from "./feature-execution.js";
import { principalDomainDefinition } from "@haibun/core/lib/resources.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { AStepper } from "@haibun/core/lib/astepper.js";
import { actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { getDefaultWorld } from "@haibun/core/lib/test/lib.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";

type TResult = { ok: boolean; errorMessage?: string; products?: { run: string; status: string; endpoint: string } };

/** Stands in for the CLI's run supervisor, under the name the agent calls: the agent reaches it by dispatching a step,
 *  so what is exercised here is the call the real supervisor answers, not a seam opened for the test. It answers a
 *  fixed tail so a read is deterministic. */
class InstanceStepper extends AStepper {
	calls: Array<{ step: string; input: Record<string, unknown> }> = [];
	ended: number | null = null;
	/** What the run has said so far. A run reports its events, which is what the agent reads it for. */
	output = "a line of output";
	steps = {
		startRun: {
			gwta: `start a haibun run of {where} matching {filter} from {from} on port {port: number} as run {run} host {hostId: number}`,
			action: (input: { where: string; filter: string; from: string; port: number; run: string; hostId: number }) => {
				this.calls.push({ step: "startRun", input });
				return Promise.resolve(actionOKWithProducts({ run: input.run, where: input.where, filter: input.filter }));
			},
		},
		readRun: {
			gwta: `read the haibun run {run} since {cursor: number}`,
			action: (input: { run: string; cursor: number }) => {
				this.calls.push({ step: "readRun", input });
				const status = this.ended === null ? "running" : "ended";
				// A supervisor accrues what its run said as it arrives; this stands in for that with the same shape.
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
			action: (input: { run: string; seconds: number; cursor: number }) => {
				this.calls.push({ step: "waitRun", input });
				return this.steps.readRun.action({ run: input.run, cursor: input.cursor });
			},
		},
		stopRun: {
			gwta: `stop the haibun run {run}`,
			action: (input: { run: string }) => {
				this.calls.push({ step: "stopRun", input });
				return Promise.resolve(actionOKWithProducts({ run: input.run }));
			},
		},
	};
}

/** The individuals a run writes, in order, so "the run is a record a finding can point at" is checked rather than assumed. */
function harness({ supervised = true, standing = false }: { supervised?: boolean; standing?: boolean } = {}) {
	const written: Array<{ label: string; data: Record<string, unknown> }> = [];
	const stepper = new TestRunnerStepper();
	const supervisor = new InstanceStepper();
	// The in-memory store the framework already has, with what it is asked to write noted in order.
	const store = new QuadStore();
	const upsert = store.upsertIndividual.bind(store);
	store.upsertIndividual = async (label: string, data: Record<string, unknown>) => {
		written.push({ label, data });
		return await upsert(label, data);
	};
	const world = getDefaultWorld();
	if (standing)
		world.moduleOptions = {
			[getStepperOptionName(stepper, "RUN_STANDS")]: "true",
			[getStepperOptionName(stepper, "RUN_PORT")]: "8331",
		};
	world.shared.getStore = () => store;
	// The Principal write declines a world with no domain registry, and runTest's productsDomain resolves its schema
	// through the same registry, so the harness registers what the stepper's own getConcerns declares in a real run.
	world.domains = mapDefinitionsToDomains([principalDomainDefinition, featureExecutionDomainDefinition]);
	const steppers = supervised ? [stepper, supervisor] : [stepper];
	for (const s of steppers) void s.setWorld(world, steppers);
	const run = (where: string, filter: string) => (stepper.steps.runTest.action as (a: { where: string; filter: string }) => Promise<TResult>)({ where, filter });
	const read = () => (stepper.steps.readTestRun.action as () => Promise<TResult & { products?: Record<string, string> }>)();
	const stop = () => (stepper.steps.stopTestRun.action as () => Promise<TResult>)();
	const waitFor = (seconds: number) => (stepper.steps.awaitTestRun.action as (a: { seconds: number }) => Promise<TResult & { products?: Record<string, string> }>)({ seconds });
	return { stepper, supervisor, written, run, read, stop, waitFor };
}

describe("the test-runner agent's limits", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("runs one test at a time: asking again while one is live names the live run rather than starting a second", async () => {
		const first = await h.run("tests", "fisheye");
		expect(first.ok).toBe(true);
		const second = await h.run("tests", "graph-frontend");
		expect(second.ok, "a second run would leave two runs and no way to say which failed").toBe(false);
		expect(second.errorMessage).toMatch(/already in flight: "fisheye"/);
		expect(h.stepper.spend().runs).toBe(1);
	});

	it("refuses to re-run unchanged features, and allows it once something has been applied", async () => {
		await h.run("tests", "fisheye");
		await h.stepper.finishRun(1);
		const again = await h.run("tests", "fisheye");
		expect(again.ok).toBe(false);
		expect(again.errorMessage).toMatch(/nothing has been applied since/);
		h.stepper.noteApplied("fisheye", "tests");
		expect((await h.run("tests", "fisheye")).ok, "after a change, the same features answer something new").toBe(true);
	});

	it("stops at its run budget with a reason, rather than running on", async () => {
		for (const filter of ["one", "two", "three"]) {
			expect((await h.run("tests", filter)).ok).toBe(true);
			await h.stepper.finishRun(0);
		}
		const past = await h.run("tests", "four");
		expect(past.ok).toBe(false);
		expect(past.errorMessage).toMatch(/run budget for this ask is spent/);
	});

	it("counts the budget against ONE ask, so the next ask starts fresh", async () => {
		for (const filter of ["one", "two", "three"]) {
			await h.run("tests", filter);
			await h.stepper.finishRun(0);
		}
		h.stepper.beginAsk();
		expect((await h.run("tests", "four")).ok).toBe(true);
	});
});

describe("what a run leaves behind", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("records the run as an individual carrying where it answers, so a finding has something to point at", async () => {
		await h.run("tests", "fisheye");
		const record = h.written.find((w) => w.label === FEATURE_EXECUTION_LABEL);
		expect(record?.data.filter).toBe("fisheye");
		expect(record?.data.status).toBe(RUN_STATUS.running);
		expect(record?.data.endpoint, "a run given no port has no endpoint, rather than an empty one").toBeUndefined();
		expect(record?.data.attributedTo, "the run names who started it, so the graph answers who ran what").toBe(TEST_RUNNER_AUTHOR);
		expect(
			h.written.some((w) => w.data.id === TEST_RUNNER_AUTHOR),
			"the agent writes its own Principal, so an attribution reaches a record",
		).toBe(true);
	});

	it("closes the run with what its exit code says, so the graph shows the outcome", async () => {
		await h.run("tests", "fisheye");
		await h.stepper.finishRun(1);
		const last = h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1);
		expect(last?.data.status).toBe(RUN_STATUS.failed);
		expect(last?.data.endedAt).toBeDefined();
		expect(h.stepper.spend().inFlight, "the run is no longer in flight, so the next one may start").toBeUndefined();
	});
});

describe("watching a run", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("starts the run through the supervisor rather than holding a process itself", async () => {
		const started = await h.run("tests", "fisheye");
		const call = h.supervisor.calls.find((c) => c.step === "startRun");
		expect(call?.input, "the agent decides what may run; the supervisor forks it").toMatchObject({ where: "tests", filter: "fisheye", from: "tests", port: RUNNER_DEFAULTS.port });
		expect(RUNNER_DEFAULTS.port, "by default a run keeps the ports its own features declare").toBe(0);
		expect(started.products?.endpoint, "and a run that was given no port answers nowhere afterwards, which its record states by carrying no endpoint").toBeUndefined();
	});

	it("fails when the run failed, so a suite that never collected a feature is never reported as passing", async () => {
		await h.run("tests", "fisheye");
		h.supervisor.ended = 1;
		const waited = await h.waitFor(30);
		expect(waited.ok, "the run's exit code is the answer; waiting for it succeeded is not").toBe(false);
		expect(waited.errorMessage).toMatch(/failed \(exit 1\)/);
		expect(waited.errorMessage, "with what the run last said, so the failure can be examined").toContain("a line of output");
	});

	it("runs every feature in a base when asked for all of them, rather than by an empty name", async () => {
		await (h.stepper.steps.runAllTests.action as (a: { where: string }) => Promise<TResult>)({ where: "tests" });
		expect(h.supervisor.calls.find((c) => c.step === "startRun")?.input.filter).toBe("");
	});

	it("follows a run to its end within the time it was given, and answers with how it ended", async () => {
		await h.run("tests", "fisheye");
		h.supervisor.ended = 0;
		const waited = await h.waitFor(30);
		expect(waited.ok).toBe(true);
		expect(waited.products?.status).toBe(RUN_STATUS.passed);
		expect(h.stepper.spend().inFlight, "a run followed to its end is closed").toBeUndefined();
	});

	it("gives up on a run that has not ended in the time it was given, rather than waiting on", async () => {
		await h.run("tests", "fisheye");
		const waited = await h.waitFor(0);
		expect(waited.ok).toBe(false);
		expect(waited.errorMessage).toMatch(/had not ended after 0 seconds/);
	});

	it("reads from where it last read, so the same output is not read twice", async () => {
		await h.run("tests", "fisheye");
		expect((await h.read()).products?.output).toBe("a line of output");
		await h.read();
		const reads = h.supervisor.calls.filter((c) => c.step === "readRun");
		expect(
			reads.map((c) => c.input.cursor),
			"the first read starts at the beginning, the next where that one ended",
		).toEqual([0, 12]);
	});

	it("closes the run's record when the run has ended, which is what releases the next run", async () => {
		await h.run("tests", "fisheye");
		h.supervisor.ended = 1;
		await h.read();
		expect(h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1)?.data.status).toBe(RUN_STATUS.failed);
		expect(h.stepper.spend().inFlight).toBeUndefined();
	});

	it("records a run it stopped as stopped, since no exit code answers for it", async () => {
		await h.run("tests", "fisheye");
		expect((await h.stop()).ok).toBe(true);
		expect(h.supervisor.calls.some((c) => c.step === "stopRun")).toBe(true);
		expect(h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1)?.data.status).toBe(RUN_STATUS.stopped);
	});

	it("says what is missing when run supervision was never registered, rather than reporting a run that does not exist", async () => {
		const h = harness({ supervised: false });
		h.stepper.beginAsk();
		const started = await h.run("tests", "fisheye");
		expect(started.ok).toBe(false);
		expect(started.errorMessage).toMatch(/InstanceStepper-startRun is not registered/);
		expect(h.stepper.spend().inFlight, "a run that was never forked is not in flight").toBeUndefined();
	});
});

describe("what a run reported", () => {
	const OUTPUT = [
		"Haibun Monitor: /features/one.feature.ts",
		'{"id":"[0.1.1.1]","kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"set answer to ready","seqPath":[0,1,1,1]}',
		'{"id":"[0.1.1.2]","kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"variable answer is other","seqPath":[0,1,1,2],"message":"answer is ready, not other"}',
		'{"id":"log.1","kind":"log","level":"info","message":"shu standalone report: file:///tmp/capture/featn-1/shu.html"}',
		'{"id":"execution-end","kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
		"not json {",
	].join("\n");

	it("reads the run's own events out of its output, and leaves its prose alone", () => {
		const events = runEvents(OUTPUT);
		expect(events).toHaveLength(4);
		expect(
			events.every((e) => typeof e.kind === "string"),
			"a line that is not an event is not one",
		).toBe(true);
	});

	it("names the step that failed, where it failed, and what it said", () => {
		const { failures, steps } = examineRun(OUTPUT);
		expect(steps).toBe(2);
		expect(failures).toEqual([{ seqPath: "0.1.1.2", step: "variable answer is other", message: "answer is ready, not other" }]);
	});

	it("finds where the run wrote its report, so a reader reaches it from the record", () => {
		expect(examineRun(OUTPUT).report).toBe("file:///tmp/capture/featn-1/shu.html");
	});

	it("carries the run's own verdict on itself, from the event that ends it", () => {
		expect(examineRun(OUTPUT).summary).toBe("the run failed");
		expect(examineRun('{"kind":"lifecycle","stage":"end","status":"completed","type":"execution"}').summary).toBe("the run completed");
	});

	it("says so when a run reported no outcome at all", () => {
		expect(examineRun("       i █ 1.2:step-dispatch ｜ ✅ [0.1.1.1] set answer to ready\n").summary).toBe("the run reported no outcome");
	});

	it("takes the report from the artifact that wrote it, and falls back to what the run announced", () => {
		expect(examineRun('{"kind":"artifact","artifactType":"html","path":"file:///tmp/capture/one/shu.html"}').report).toBe("file:///tmp/capture/one/shu.html");
		expect(examineRun(OUTPUT).report, "announced in a log line when no artifact event carries it").toBe("file:///tmp/capture/featn-1/shu.html");
	});
});

describe("where a run is started from", () => {
	let h: ReturnType<typeof harness>;
	beforeEach(() => {
		h = harness();
		h.stepper.beginAsk();
	});

	it("runs a base from the base itself, which is where its own command line runs it from", async () => {
		await h.run("../tests", "fisheye");
		expect(h.supervisor.calls.find((c) => c.step === "startRun")?.input.from, "a relative stepper path in its config means what it means there").toBe("../tests");
	});
});

describe("what a finished run's record says about it", () => {
	it("carries what the run did, so a reader with the run has its outcome without asking again", async () => {
		const h = harness();
		h.stepper.beginAsk();
		await h.run("tests", "fisheye");
		h.supervisor.ended = 0;
		h.supervisor.output = [
			'{"kind":"lifecycle","stage":"end","status":"completed","type":"step","in":"a step","seqPath":[0,1,1,1]}',
			'{"kind":"lifecycle","stage":"end","status":"failed","type":"step","in":"another","seqPath":[0,1,1,2],"message":"it said no"}',
			'{"id":"feat-1","kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"id":"feat-1","kind":"lifecycle","stage":"start","status":"running","type":"feature"}',
			'{"kind":"lifecycle","stage":"end","status":"failed","type":"execution"}',
		].join("\n");
		await h.waitFor(30);
		const record = h.written.filter((w) => w.label === FEATURE_EXECUTION_LABEL).at(-1);
		expect(record?.data.steps, "how many steps the run ran").toBe(2);
		expect(record?.data.features, "a feature reported twice is one feature").toBe(1);
		expect(record?.data.failed).toBe(1);
		expect(record?.data.firstFailure, "and the first thing that went wrong, where it went wrong").toBe("0.1.1.2: another (it said no)");
	});

	describe("running a test as a GOAL", () => {
		it("resolves feature-execution to the run steps, so the resolver can offer running a test rather than only prose", async () => {
			// The run's record is the step's declared product, so the goal graph carries a producer edge to it: resolve
			// `feature-execution` and the michi is runTest (or runAllTests) — an affordance, not a convention.
			const { buildDomainChain } = await import("@haibun/core/lib/domain-chain.js");
			const { resolveGoal, GOAL_FINDING } = await import("@haibun/core/lib/goal-resolver.js");
			const stepper = new TestRunnerStepper();
			const domains = mapDefinitionsToDomains([featureExecutionDomainDefinition]);
			const graph = buildDomainChain([stepper as never], domains);
			const producers = graph.edges.filter((e) => e.to === "feature-execution").map((e) => e.stepName);
			expect(producers, "both ways of starting a run produce the record").toEqual(expect.arrayContaining(["runTest", "runAllTests"]));
			const resolved = resolveGoal("feature-execution", { graph, facts: [], capabilities: new Set(["Instance:run"]) });
			expect(resolved.finding, "a michi is the way there").toBe(GOAL_FINDING.MICHI);
			const steps = "michi" in resolved ? resolved.michi.flatMap((m) => m.steps.map((s) => s.stepName)) : [];
			expect(steps).toContain("runTest");
		});
	});

	describe("a question put to a standing run", () => {
		it("reads pairs, JSON, and a bare value for a step that takes one thing", () => {
			expect(askParams("domain=comment"), "what a model writes").toEqual({ domain: "comment" });
			expect(askParams("perTypeLimit=300, accessLevel=private"), "several, with their own types").toEqual({ perTypeLimit: 300, accessLevel: "private" });
			expect(askParams('{"domain": "comment"}'), "JSON from a caller that can write it").toEqual({ domain: "comment" });
			expect(askParams("comment", ["domain"]), "and a bare value where only one thing is taken").toEqual({ domain: "comment" });
			expect(askParams("comment", ["domain", "sort"]), "but not where the step takes more than one").toEqual({});
			expect(askParams(""), "nothing said is nothing given").toEqual({});
		});

		it("takes the step half of a name where it names one step there", () => {
			expect(stepAtRun([{ name: "host9_RemoteSteps-listTyped" }], 9, "listTyped")?.name, "one step is named, so it is the one meant").toBe("host9_RemoteSteps-listTyped");
			expect(stepAtRun([{ name: "host9_RemoteSteps-listTyped" }], 9, "RemoteSteps-listTyped")?.name, "and the whole name is the name").toBe("host9_RemoteSteps-listTyped");
			expect(stepAtRun([{ name: "host9_A-listTyped" }, { name: "host9_B-listTyped" }], 9, "listTyped"), "two steps of that name is not a name").toBeUndefined();
		});

		it("hands a model what the run said about itself, and keeps the entries beside it", () => {
			const asked = answerOfRun({ vertices: [{ id: "cmt-1" }], total: 1 });
			expect(asked.text, "counted, and what it says about itself first").toBe('{"total":1,"vertices":"1 entries; ask the run for one to see it"}');
			expect(asked.answer, "the entries are there for a caller that wants them").toBe('{"total":1,"vertices":[{"id":"cmt-1"}]}');
			const long = answerOfRun({ total: 40, vertices: Array.from({ length: 500 }, (_, at) => ({ id: `cmt-${at}`, body: "x".repeat(40) })) });
			expect(long.answer, "and a listing longer than a window says how much was left").toMatch(/characters in all\)$/);
		});
	});
});
