/**
 * A chain instance holds the state of one walk for the chain-walker.
 *
 * A chain instance records one walk through a resolver michi: which
 * goal it targets, which michi (path) was chosen, the current step index,
 * the args supplied for each step, and the seqPaths of the facts each step
 * has produced. The working-memory quad store holds the instance in the
 * `CHAIN_INSTANCE_GRAPH` named graph. A quad store query reads the
 * instance's state the same way as every other fact.
 *
 * The chain-walker dispatches each step of an instance through
 * `callStepByName`. That call allocates a synthetic seqPath, and the instance
 * records it as the step's fact id. Dispatch derives the ids of the step's
 * product facts from that seqPath, so they don't collide with facts of other
 * calls.
 *
 * One instance is one quad subject, and each field is one predicate.
 * `getChainInstance` reads each predicate of that subject in the chain named
 * graph and assembles a `TChainInstance`.
 */
import type { TWorld } from "./world.js";
import type { IQuadStore } from "./quad-types.js";
import type { TMichi } from "./goal-resolver.js";
import { actingAs, readingAt } from "./capability-context.js";
import { Access } from "./resources.js";

/** The named graph that holds chain-instance facts. */
export const CHAIN_INSTANCE_GRAPH = "chain/instance";

/** Predicates used inside the chain-instance named graph. */
const CHAIN_INSTANCE_PREDICATE = {
	GOAL: "goal",
	MICHI: "michi",
	STEP_INDEX: "stepIndex",
	STATUS: "status",
	STEP_ARGS: "stepArgs",
	STEP_FACT_IDS: "stepFactIds",
	CREATED_AT: "createdAt",
	UPDATED_AT: "updatedAt",
	/** The principal that began the walk. Only that principal may advance the walk. */
	OWNER: "owner",
} as const;

export const CHAIN_INSTANCE_STATUS = {
	/** The next step hasn't run yet. */
	PENDING: "pending",
	/** A step is dispatched and hasn't returned its result yet. */
	RUNNING: "running",
	/** Every step in the chosen michi passed, and the walk is complete. */
	COMPLETED: "completed",
	/** The step isn't registered, its arguments failed validation, or the step failed. The walk stops at the current step index. */
	FAILED: "failed",
} as const;

type TChainInstanceStatus = (typeof CHAIN_INSTANCE_STATUS)[keyof typeof CHAIN_INSTANCE_STATUS];

/**
 * The in-memory shape of a chain instance. `getChainInstance` assembles it
 * from the quads under one subject. `stepArgs[i]` holds the argument map
 * supplied for step `i`. `stepFactIds[i]` holds the seqPath from which
 * dispatch derived the ids of step `i`'s product facts.
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
	/** The principal that began the walk, where a principal was acting. A call without a principal begins a walk without an
	 *  owner. A feature that walks toward a goal begins such a walk. */
	owner?: string;
};

function nowMs(): number {
	return Date.now();
}

/** Generates a chain-instance id from the time and a random suffix. It isn't a UUID. */
function newChainInstanceId(): string {
	return `ci_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Replaces one predicate of an instance. The graph isn't a declared type, so the quad states its level: the read level
 *  of the call that walks the instance, so the walk's owner reads it back. The instance's own walk, outside a call, reads
 *  every level and is written at private. */
async function writePredicate(store: IQuadStore, instanceId: string, predicate: string, value: unknown): Promise<void> {
	const ceiling = readingAt();
	await store.remove({ subject: instanceId, predicate, namedGraph: CHAIN_INSTANCE_GRAPH });
	await store.add({ subject: instanceId, predicate, object: value, namedGraph: CHAIN_INSTANCE_GRAPH, accessLevel: ceiling === undefined ? Access.private : ceiling });
}

/**
 * Creates a chain instance for the given goal and michi. It allocates an id,
 * writes every predicate of the initial state, and returns the assembled
 * `TChainInstance`.
 */
export async function createChainInstance(world: TWorld, goal: string, michi: TMichi): Promise<TChainInstance> {
	const store: IQuadStore = world.shared.getStore();
	const id = newChainInstanceId();
	const createdAt = nowMs();
	// The owner is read from the acting principal instead of a parameter. A parameter would let a caller omit the owner,
	// and any caller without a principal may advance a walk without an owner.
	const owner = actingAs();
	const inst: TChainInstance = {
		id,
		goal,
		michi,
		stepIndex: 0,
		status: CHAIN_INSTANCE_STATUS.PENDING,
		stepArgs: michi.steps.map((): Record<string, unknown> => ({})),
		stepFactIds: michi.steps.map((): string[] => []),
		createdAt,
		updatedAt: createdAt,
		...(owner === undefined ? {} : { owner }),
	};
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.GOAL, goal);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.MICHI, michi);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_INDEX, 0);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STATUS, CHAIN_INSTANCE_STATUS.PENDING);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_ARGS, inst.stepArgs);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.STEP_FACT_IDS, inst.stepFactIds);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.CREATED_AT, createdAt);
	await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.UPDATED_AT, createdAt);
	if (owner !== undefined) await writePredicate(store, id, CHAIN_INSTANCE_PREDICATE.OWNER, owner);
	return inst;
}

/**
 * Loads a chain instance by id. Returns `undefined` if the instance doesn't exist.
 * Throws if the instance is partially written. A missing required predicate
 * indicates corrupted store state, not a missing instance.
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
	const owner = (await store.get(id, CHAIN_INSTANCE_PREDICATE.OWNER, CHAIN_INSTANCE_GRAPH)) as string | undefined;
	if (
		michi === undefined ||
		stepIndex === undefined ||
		status === undefined ||
		stepArgs === undefined ||
		stepFactIds === undefined ||
		createdAt === undefined ||
		updatedAt === undefined
	) {
		throw new Error(`chain instance ${id} is partially written in ${CHAIN_INSTANCE_GRAPH}: one or more required predicates are missing. Begin a new walk toward its goal.`);
	}
	return { id, goal: goal as string, michi, stepIndex, status, stepArgs, stepFactIds, createdAt, updatedAt, ...(owner === undefined ? {} : { owner }) };
}

/**
 * Writes the supplied fields of an existing chain instance. Every call also
 * writes `updatedAt`. The chain-walker calls it to set the status before and
 * after each step, to advance `stepIndex` and to append the produced fact ids.
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
 * Returns every chain instance in the quad store, unsorted. A caller that
 * needs recency sorts by `updatedAt`.
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

/** Removes a chain instance and every predicate of its subject. */
export async function deleteChainInstance(world: TWorld, id: string): Promise<void> {
	const store: IQuadStore = world.shared.getStore();
	await store.remove({ subject: id, namedGraph: CHAIN_INSTANCE_GRAPH });
}
