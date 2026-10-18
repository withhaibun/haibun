/** The actuality machine moves each level as its table states, and a reader of the stream holds the counts. */
import { describe, expect, it } from "vitest";
import { EXECUTION_MODE, STATUS } from "../../domains/protocol.js";
import { assertTable, pickWith, runSequences, staying } from "../../test/machine-table.js";
import { INITIAL_ACTUALITY, LEVEL_STATUS, actualityMachine, runningFeature, transition, type TActuality, type TActualityMove } from "./actuality.js";

const fold = (moves: readonly TActualityMove[], from: TActuality = INITIAL_ACTUALITY): TActuality => moves.reduce(transition, from);
const execution = (stage: "start" | "end", status?: string): TActualityMove => ({
	type: "execution",
	stage,
	id: `execution-${stage}`,
	...(status === undefined ? {} : { status }),
});
const feature = (id: string, stage: "start" | "end", status?: string): TActualityMove => ({
	type: "feature",
	stage,
	id,
	featurePath: `/features/${id}.feature`,
	featureName: id,
	...(status === undefined ? {} : { status }),
});
const scenario = (id: string, stage: "start" | "end", status?: string): TActualityMove => ({
	type: "scenario",
	stage,
	id,
	scenarioName: id,
	...(status === undefined ? {} : { status }),
});
const step = (id: string, stage: "start" | "end", status?: string, more: Partial<TActualityMove> = {}): TActualityMove => ({
	type: "step",
	stage,
	id,
	in: `step ${id}`,
	...(status === undefined ? {} : { status }),
	...more,
});

describe("the execution level", () => {
	const EVENTS = ["start", "completed", "failed", "featureStart", "stepFailed"] as const;
	type TEvent = (typeof EVENTS)[number];
	type TStatus = "pending" | "running" | "completed" | "failed";
	const MOVE: Record<TEvent, TActualityMove> = {
		start: execution("start"),
		completed: execution("end", STATUS.completed),
		failed: execution("end", STATUS.failed),
		featureStart: feature("f1", "start"),
		stepFailed: step("0.1.1.1", "end", STATUS.failed),
	};
	const TABLE: Record<TStatus, Record<TEvent, TStatus>> = {
		pending: staying(EVENTS, "pending", { start: "running", completed: "completed", failed: "failed", featureStart: "running" }),
		running: staying(EVENTS, "running", { completed: "completed", failed: "failed" }),
		completed: staying(EVENTS, "completed", { start: "running" }),
		failed: staying(EVENTS, "failed", { start: "running" }),
	};
	const AT: Record<TStatus, TActuality> = {
		pending: INITIAL_ACTUALITY,
		running: fold([MOVE.start]),
		completed: fold([MOVE.start, MOVE.completed]),
		failed: fold([MOVE.start, MOVE.failed]),
	};

	it("moves as its table states", () => {
		assertTable(TABLE, AT, { events: EVENTS, statusOf: (state) => state.status as TStatus, event: (type) => MOVE[type], transition });
	});

	it("starts a second execution afresh once the first has ended", () => {
		const second = fold([feature("f1", "start"), step("0.1.1.1", "end", STATUS.completed), MOVE.completed, MOVE.start]);
		expect(second).toEqual({ ...INITIAL_ACTUALITY, status: LEVEL_STATUS.running });
	});
});

describe("the feature level", () => {
	const EVENTS = ["start", "completed", "failed", "otherStart", "executionEnd"] as const;
	type TEvent = (typeof EVENTS)[number];
	type TStatus = "absent" | "running" | "completed" | "failed";
	const MOVE: Record<TEvent, TActualityMove> = {
		start: feature("f1", "start"),
		completed: feature("f1", "end", STATUS.completed),
		failed: feature("f1", "end", STATUS.failed),
		otherStart: feature("f2", "start"),
		executionEnd: execution("end", STATUS.failed),
	};
	const TABLE: Record<TStatus, Record<TEvent, TStatus>> = {
		absent: staying(EVENTS, "absent", { start: "running" }),
		running: staying(EVENTS, "running", { completed: "completed", failed: "failed" }),
		completed: staying(EVENTS, "completed", {}),
		failed: staying(EVENTS, "failed", {}),
	};
	const started = fold([execution("start")]);
	const AT: Record<TStatus, TActuality> = {
		absent: started,
		running: fold([MOVE.start], started),
		completed: fold([MOVE.start, MOVE.completed], started),
		failed: fold([MOVE.start, MOVE.failed], started),
	};
	const statusOf = (state: TActuality): TStatus => {
		const held = state.features.find((f) => f.id === "f1");
		return held === undefined ? "absent" : (held.status as TStatus);
	};

	it("moves as its table states", () => {
		assertTable(TABLE, AT, { events: EVENTS, statusOf, event: (type) => MOVE[type], transition });
	});

	it("doesn't start a feature after its execution ended", () => {
		expect(fold([execution("end", STATUS.completed), feature("f3", "start")], started).features).toEqual([]);
	});
});

describe("the scenario level", () => {
	const EVENTS = ["start", "end", "otherStart", "featureEnd"] as const;
	type TEvent = (typeof EVENTS)[number];
	type TStatus = "absent" | "running" | "completed";
	const MOVE: Record<TEvent, TActualityMove> = {
		start: scenario("s1", "start"),
		end: scenario("s1", "end", STATUS.completed),
		otherStart: scenario("s2", "start"),
		featureEnd: feature("f1", "end", STATUS.completed),
	};
	const TABLE: Record<TStatus, Record<TEvent, TStatus>> = {
		absent: staying(EVENTS, "absent", { start: "running" }),
		running: staying(EVENTS, "running", { end: "completed" }),
		completed: staying(EVENTS, "completed", {}),
	};
	const inFeature = fold([execution("start"), feature("f1", "start")]);
	const AT: Record<TStatus, TActuality> = { absent: inFeature, running: fold([MOVE.start], inFeature), completed: fold([MOVE.start, MOVE.end], inFeature) };
	const statusOf = (state: TActuality): TStatus => {
		const held = state.features.at(-1)?.scenarios.find((s) => s.id === "s1");
		return held === undefined ? "absent" : (held.status as TStatus);
	};

	it("moves as its table states", () => {
		assertTable(TABLE, AT, { events: EVENTS, statusOf, event: (type) => MOVE[type], transition });
	});

	it("doesn't start a scenario outside a running feature", () => {
		expect(fold([MOVE.start], fold([execution("start")])).features).toEqual([]);
	});
});

describe("the step level", () => {
	const EVENTS = ["start", "end"] as const;
	type TEvent = (typeof EVENTS)[number];
	type TStatus = "closed" | "open" | "twice";
	const MOVE: Record<TEvent, TActualityMove> = { start: step("0.1.1.1", "start"), end: step("0.1.1.1", "end", STATUS.completed) };
	const TABLE: Record<TStatus, Record<TEvent, TStatus>> = {
		closed: { start: "open", end: "closed" },
		open: { start: "twice", end: "closed" },
		twice: { start: "twice", end: "open" },
	};
	const AT: Record<TStatus, TActuality> = { closed: INITIAL_ACTUALITY, open: fold([MOVE.start]), twice: fold([MOVE.start, MOVE.start]) };
	const statusOf = (state: TActuality): TStatus => {
		const held = state.open.get("0.1.1.1");
		return held === undefined ? "closed" : held === 1 ? "open" : "twice";
	};

	it("moves as its table states", () => {
		// A third start of one id counts three, which the table reads as more than once.
		assertTable(TABLE, AT, { events: EVENTS, statusOf, event: (type) => MOVE[type], transition });
	});

	it("counts each step that ends within its feature, and lists the execution's own failures", () => {
		const state = fold([
			execution("start"),
			feature("f1", "start"),
			step("0.1.1.1", "end", STATUS.completed),
			step("0.1.1.2", "end", STATUS.failed, { error: "the answer is other" }),
			step("0.1.1.3", "end", STATUS.failed, { intent: { mode: EXECUTION_MODE.speculative } }),
			step("0.1.1.2.-1", "end", STATUS.failed),
			step("0.1.1.4", "end", STATUS.failed),
		]);
		const first = { id: "0.1.1.2", step: "step 0.1.1.2", message: "the answer is other" };
		expect(state.steps).toBe(5);
		expect(state.failures).toEqual([first, { id: "0.1.1.4", step: "step 0.1.1.4" }]);
		expect(runningFeature(state)).toMatchObject({ steps: 5, failed: 2, firstFailure: first });
	});
});

describe("the actuality machine", () => {
	it("moves on every step, and holds as many steps as ended since its execution started, with each open count above zero, after any sequence", () => {
		const MOVES = [execution("start"), feature("f1", "start"), feature("f1", "end", STATUS.completed), step("1", "start"), step("1", "end", STATUS.completed), step("2", "start")];
		runSequences(
			() => ({ held: actualityMachine(), ended: 0 }),
			(context, random, label) => {
				const move = pickWith(random, MOVES);
				const before = context.held.state.get();
				const after = context.held.dispatch(move);
				if (move.type === "step") {
					expect(after, label(`${move.id} ${move.stage}`)).not.toBe(before);
					if (move.stage === "end") context.ended += 1;
				} else {
					label(`${move.type} ${move.stage}`);
					// An execution that starts after another ended starts its counts afresh.
					if (move.type === "execution" && move.stage === "start" && before.status !== LEVEL_STATUS.running) context.ended = 0;
				}
				expect(after.steps).toBe(context.ended);
				expect([...after.open.values()].every((count) => count > 0)).toBe(true);
			},
		);
	});
});
