/**
 * Chain instances — durable per-walk state for the chain-walker.
 *
 * A chain instance records one user's walk through a resolver michi: which
 * goal it targets, which michi (path) was chosen, the current step index,
 * the args supplied for each step, and the seqPaths of the facts each step
 * has produced. The instance lives in the working-memory quad store under
 * the `CHAIN_INSTANCE_GRAPH` named graph so the SPA can subscribe to its
 * state the same way it reads every other fact.
 *
 * Each step within an instance dispatches with a derived seqPath
 *   `[chain, <instanceId>, <stepIndex>]`
 * so the auto-asserted product facts carry their position in the walk and
 * don't collide with each other or with facts produced by ad-hoc step runs.
 *
 * One instance is one quad-subject; each field is one predicate. Reading an
 * instance back means fetching every quad with that subject in the chain
 * named graph and assembling them into a `TChainInstance`.
 */
import type { TWorld } from "./world.js";
import type { IQuadStore } from "./quad-types.js";
import type { TMichi } from "./goal-resolver.js";

/** Named graph that carries chain-instance facts. */
export const CHAIN_INSTANCE_GRAPH = "chain/instance";

/** Predicates used inside the chain-instance named graph. */
export const CHAIN_INSTANCE_PREDICATE = {
	GOAL: "goal",
	MICHI: "michi",
	STEP_INDEX: "stepIndex",
	STATUS: "status",
	STEP_ARGS: "stepArgs",
	STEP_FACT_IDS: "stepFactIds",
	CREATED_AT: "createdAt",
	UPDATED_AT: "updatedAt",
} as const;

export const CHAIN_INSTANCE_STATUS = {
	/** Instance created; waiting for the first step to run. */
	PENDING: "pending",
	/** A step is currently dispatched and hasn't yet emitted its product. */
	RUNNING: "running",
	/** All steps in the chosen michi have produced facts; the walk is done. */
	COMPLETED: "completed",
	/** A step failed; the walk halts at the current step index. */
	FAILED: "failed",
} as const;

export type TChainInstanceStatus = (typeof CHAIN_INSTANCE_STATUS)[keyof typeof CHAIN_INSTANCE_STATUS];

/**
 * In-memory shape of a chain instance, assembled from the quads under one
 * subject. `stepArgs[i]` carries the argument map supplied for step `i`;
 * `stepFactIds[i]` carries the seqPaths of the facts that step's product
 * was asserted under (one per declared output domain).
 */
export type TChainInstance = {
	id: string;
	goal: string;
	michi: TMichi;
	stepIndex: number;
	status: TChainInstanceStatus;
	stepArgs: Array<Record<string, unknown>>;
	stepFactIds: string[][];
	createdAt: number;
	updatedAt: number;
};

/**
 * Allocate a numeric seqPath for a chain step dispatch. Reuses the existing
 * synthetic-seqPath machinery (see `allocateSyntheticSeqPath`) so chain steps
 * carry a unique, traceable numeric path that the dispatcher already knows
 * how to handle. The returned path is recorded in the chain instance's
 * `stepFactIds[i]` so the SPA can link back to the produced facts.
 */
export type TWorldForSeqPath = { tag: { hostId: number }; runtime: { adHocSeq?: number } };

function nowMs(): number {
	return Date.now();
}

/** Generate a chain-instance id. Stable enough for one runtime; not a UUID. */
export function newChainInstanceId(): string {
	return `ci_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writePredicate(store: IQuadStore, instanceId: string, predicate: string, value: unknown): Promise<void> {
	await store.set(instanceId, predicate, value, CHAIN_INSTANCE_GRAPH);
}

/**
 * Create a new chain instance for the given goal + michi. Allocates an id,
 * persists every predicate of the seed state, and returns the assembled
 * `TChainInstance` so the caller can drive the first step immediately.
 */
export async function createChainInstance(world: TWorld, goal: string, michi: TMichi): Promise<TChainInstance> {
	const store: IQuadStore = world.shared.getStore();
	const id = newChainInstanceId();
	const createdAt = nowMs();
	const inst: TChainInstance = {
		id,
		goal,
		michi,
		stepIndex: 0,
		status: CHAIN_INSTANCE_STATUS.PENDING,
		stepArgs: michi.steps.map(() => ({}) as Record<string, unknown>),
		stepFactIds: michi.steps.map((): string[] => []),
		createdAt,
		updatedAt: createdAt,
	};
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.GOAL, goal);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.MICHI, michi);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_INDEX, 0);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STATUS, CHAIN_INSTANCE_STATUS.PENDING);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_ARGS, inst.stepArgs);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_FACT_IDS, inst.stepFactIds);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.CREATED_AT, createdAt);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.UPDATED_AT, createdAt);
	return inst;
}

/**
 * Load a chain instance by id. Returns `undefined` if the instance doesn't exist.
 * Throws if the instance is partially written — a missing predicate other than
 * the optional ones indicates corrupted store state, not a missing instance.
 */
export async function getChainInstance(world: TWorld, id: string): Promise<TChainInstance | undefined> {
	const store: IQuadStore = world.shared.getStore();
	const goal = await store.get(id, CHAIN_INSTANCE_PREDICATE.GOAL, CHAIN_INSTANCE_GRAPH);
	if (goal === undefined) return undefined;
	const michi = (await store.get(id, CHAIN_INSTANCE_PREDICATE.MICHI, CHAIN_INSTANCE_GRAPH)) as TMichi | undefined;
	const stepIndex = (await store.get(id, CHAIN_INSTANCE_PREDICATE.STEP_INDEX, CHAIN_INSTANCE_GRAPH)) as number | undefined;
	const status = (await store.get(id, CHAIN_INSTANCE_PREDICATE.STATUS, CHAIN_INSTANCE_GRAPH)) as TChainInstanceStatus | undefined;
	const stepArgs = (await store.get(id, CHAIN_INSTANCE_PREDICATE.STEP_ARGS, CHAIN_INSTANCE_GRAPH)) as Array<Record<string, unknown>> | undefined;
	const stepFactIds = (await store.get(id, CHAIN_INSTANCE_PREDICATE.STEP_FACT_IDS, CHAIN_INSTANCE_GRAPH)) as string[][] | undefined;
	const createdAt = (await store.get(id, CHAIN_INSTANCE_PREDICATE.CREATED_AT, CHAIN_INSTANCE_GRAPH)) as number | undefined;
	const updatedAt = (await store.get(id, CHAIN_INSTANCE_PREDICATE.UPDATED_AT, CHAIN_INSTANCE_GRAPH)) as number | undefined;
	if (
		michi === undefined ||
		stepIndex === undefined ||
		status === undefined ||
		stepArgs === undefined ||
		stepFactIds === undefined ||
		createdAt === undefined ||
		updatedAt === undefined
	) {
		throw new Error(`chain instance ${id} is partially written: missing one or more required predicates in ${CHAIN_INSTANCE_GRAPH}`);
	}
	return { id, goal: goal as string, michi, stepIndex, status, stepArgs, stepFactIds, createdAt, updatedAt };
}

/**
 * Persist a mutation to an existing chain instance. Only the supplied fields
 * are written; `updatedAt` is refreshed on every call. The dispatcher uses
 * this after each step run to advance `stepIndex` and append produced fact ids.
 */
export async function updateChainInstance(world: TWorld, id: string, patch: Partial<Omit<TChainInstance, "id" | "createdAt">>): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	const updatedAt = nowMs();
	if (patch.goal !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.GOAL, patch.goal);
	if (patch.michi !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.MICHI, patch.michi);
	if (patch.stepIndex !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_INDEX, patch.stepIndex);
	if (patch.status !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STATUS, patch.status);
	if (patch.stepArgs !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_ARGS, patch.stepArgs);
	if (patch.stepFactIds !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_FACT_IDS, patch.stepFactIds);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.UPDATED_AT, updatedAt);
}

/**
 * Enumerate every chain instance currently in the quad store. The result is
 * unsorted; callers that need recency can sort by `updatedAt`.
 */
export async function listChainInstances(world: TWorld): Promise<TChainInstance[]> {
	const store: IQuadStore = world.shared.getStore();
	const quads = await store.query({ namedGraph: CHAIN_INSTANCE_GRAPH, predicate: CHAIN_INSTANCE_PREDICATE.GOAL });
	const out: TChainInstance[] = [];
	for (const q of quads) {
		const inst = await getChainInstance(world, q.subject);
		if (inst) out.push(inst);
	}
	return out;
}

/** Remove a chain instance and every predicate it owns. Useful for test cleanup and explicit user cancellation. */
export async function deleteChainInstance(world: TWorld, id: string): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	await store.remove({ subject: id, namedGraph: CHAIN_INSTANCE_GRAPH });
}
