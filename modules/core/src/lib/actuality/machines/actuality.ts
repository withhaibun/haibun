/**
 * The actuality machine. It holds an execution's levels, the execution, its features, each feature's scenarios and the
 * steps in flight, each with a start and an end. Its moves are lifecycle events: the Executor dispatches each one before
 * it emits it, so the stream carries only the machine's moves, and a reader that passes each event to `transition`
 * holds the same state from the events alone.
 *
 * A move the state doesn't accept leaves the state unchanged: a second start of a level that is running, an end of a
 * level that isn't running, and a feature or a scenario after its execution ended. A reader that reads a stream twice,
 * or joins it after an execution started, holds each level once.
 */
import { z } from "zod";
import { ACTUALITY_LEVELS, STATUS, isHandedOutEvent, isSpeculativeEvent, type TActualityLevel } from "../../domains/protocol.js";
import { machine, type Machine } from "../../machines/machine.js";
import { LEVEL_STATUS, type TLevelStatus } from "../domains/level-status.js";
import type { TStepFailure } from "../domains/step-failure.js";

/** The statuses that end a level. */
export type TLevelEnd = Exclude<TLevelStatus, typeof STATUS.pending | typeof STATUS.running>;
const ENDS: ReadonlySet<string> = new Set<TLevelEnd>([LEVEL_STATUS.completed, LEVEL_STATUS.failed, LEVEL_STATUS.stopped]);

/** Whether a status ends a level. */
export const isLevelEnd = (status: string | undefined): status is TLevelEnd => status !== undefined && ENDS.has(status);

/** A lifecycle event of a level, as the machine reads it: a reader of a run's output parses the fields it carries. */
export const ActualityMoveSchema = z.object({
	type: z.enum(ACTUALITY_LEVELS),
	stage: z.enum(["start", "end"]),
	id: z.string(),
	status: z.string().optional(),
	featurePath: z.string().optional(),
	featureName: z.string().optional(),
	scenarioName: z.string().optional(),
	in: z.string().optional(),
	error: z.string().optional(),
	intent: z.object({ mode: z.string().optional() }).optional(),
});
export type TActualityMove = z.infer<typeof ActualityMoveSchema>;

export type TScenarioState = { id: string; name?: string; status: TLevelStatus };

/** A feature's level: its status, its scenarios, the steps that ended within it, and how many and which first failed. */
export type TFeatureState = {
	id: string;
	name?: string;
	path?: string;
	status: TLevelStatus;
	scenarios: readonly TScenarioState[];
	steps: number;
	failed: number;
	firstFailure?: TStepFailure;
};

/** An execution's levels. `open` counts each step id in flight, since two callers may carry one id. `steps` counts the
 *  steps that ended, within a feature or outside every feature, and `failures` lists the execution's own failures. */
export type TActuality = { status: TLevelStatus; features: readonly TFeatureState[]; open: ReadonlyMap<string, number>; steps: number; failures: readonly TStepFailure[] };

export const INITIAL_ACTUALITY: TActuality = { status: LEVEL_STATUS.pending, features: [], open: new Map(), steps: 0, failures: [] };

/** The feature that is running: the last to start, where it hasn't ended. */
export function runningFeature(state: TActuality): TFeatureState | undefined {
	const last = state.features.at(-1);
	return last?.status === LEVEL_STATUS.running ? last : undefined;
}

/** Whether the execution has ended. */
export const executionEnded = (state: TActuality): boolean => isLevelEnd(state.status);

/** A level's name, where its start states one. */
const named = (name: string | undefined): { name?: string } => (name === undefined ? {} : { name });

/** The state with its running feature replaced. */
const withRunning = (state: TActuality, feature: TFeatureState): TActuality => ({ ...state, features: [...state.features.slice(0, -1), feature] });

function executionMove(state: TActuality, move: TActualityMove): TActuality {
	if (move.stage === "start") return state.status === LEVEL_STATUS.running ? state : { ...INITIAL_ACTUALITY, status: LEVEL_STATUS.running };
	return isLevelEnd(move.status) && !executionEnded(state) ? { ...state, status: move.status } : state;
}

function featureMove(state: TActuality, move: TActualityMove): TActuality {
	if (executionEnded(state)) return state;
	const { id } = move;
	if (move.stage === "start") {
		if (state.features.some((feature) => feature.id === id) || runningFeature(state) !== undefined) return state;
		const feature: TFeatureState = {
			id,
			...named(move.featureName),
			...(move.featurePath === undefined ? {} : { path: move.featurePath }),
			status: LEVEL_STATUS.running,
			scenarios: [],
			steps: 0,
			failed: 0,
		};
		return { ...state, status: LEVEL_STATUS.running, features: [...state.features, feature] };
	}
	const running = runningFeature(state);
	if (running === undefined || running.id !== id || !isLevelEnd(move.status)) return state;
	return withRunning(state, { ...running, status: move.status });
}

function scenarioMove(state: TActuality, move: TActualityMove): TActuality {
	const feature = runningFeature(state);
	if (feature === undefined) return state;
	const { id } = move;
	const last = feature.scenarios.at(-1);
	if (move.stage === "start") {
		if (feature.scenarios.some((scenario) => scenario.id === id) || last?.status === LEVEL_STATUS.running) return state;
		const scenario: TScenarioState = { id, ...named(move.scenarioName), status: LEVEL_STATUS.running };
		return withRunning(state, { ...feature, scenarios: [...feature.scenarios, scenario] });
	}
	if (last === undefined || last.id !== id || last.status !== LEVEL_STATUS.running || !isLevelEnd(move.status)) return state;
	return withRunning(state, { ...feature, scenarios: [...feature.scenarios.slice(0, -1), { ...last, status: move.status }] });
}

/** The failure a step's end states, where it is the execution's own: a speculative step's failure is expected, and a
 *  handed-out call returns its failure to its caller. */
function failureOf(move: TActualityMove, id: string): TStepFailure | undefined {
	if (move.status === LEVEL_STATUS.completed || isSpeculativeEvent(move) || isHandedOutEvent(move)) return undefined;
	return { id, ...(move.in === undefined ? {} : { step: move.in }), ...(move.error === undefined ? {} : { message: move.error }) };
}

function stepMove(state: TActuality, move: TActualityMove): TActuality {
	const { id } = move;
	const open = new Map(state.open);
	const held = open.get(id);
	if (move.stage === "start") {
		open.set(id, held === undefined ? 1 : held + 1);
		return { ...state, open };
	}
	if (held !== undefined && held > 1) open.set(id, held - 1);
	else open.delete(id);
	const failure = failureOf(move, id);
	const ended: TActuality = { ...state, open, steps: state.steps + 1, failures: failure === undefined ? state.failures : [...state.failures, failure] };
	const feature = runningFeature(state);
	if (feature === undefined) return ended;
	const counted: TFeatureState = { ...feature, steps: feature.steps + 1 };
	if (failure === undefined) return withRunning(ended, counted);
	return withRunning(ended, { ...counted, failed: feature.failed + 1, ...(feature.firstFailure === undefined ? { firstFailure: failure } : {}) });
}

const MOVES: Record<TActualityLevel, (state: TActuality, move: TActualityMove) => TActuality> = {
	execution: executionMove,
	feature: featureMove,
	scenario: scenarioMove,
	step: stepMove,
};

/** The next state from a lifecycle event of a level. */
export const transition = (state: TActuality, move: TActualityMove): TActuality => MOVES[move.type](state, move);

/** Whether a lifecycle event is a level's: the other lifecycle types, such as an activity or an ensure, aren't moves. */
export const isActualityMove = (event: { kind?: unknown; type?: unknown; stage?: unknown }): event is TActualityMove =>
	event.kind === "lifecycle" && (ACTUALITY_LEVELS as readonly unknown[]).includes(event.type) && (event.stage === "start" || event.stage === "end");

export type TActualityMachine = Machine<TActuality, TActualityMove>;

/** A machine at the initial state: an execution that hasn't started. */
export const actualityMachine = (): TActualityMachine => machine(INITIAL_ACTUALITY, transition);
