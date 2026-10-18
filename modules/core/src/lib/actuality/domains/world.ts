import { z } from "zod";
import type { TActualityId } from "../../transport/ports.js";
import type { TTag } from "../../domains/ttag.js";
import type { FeatureVariables } from "../pipelines/feature-variables.js";
import type { Prompter } from "../../prompter.js";
import type { IEventLogger } from "../../steps/ports.js";
import type { TStepResult, TFeatureSteps } from "../../domains/protocol.js";
import { CONTINUE_AFTER_ERROR, NDJSON, ShownLogLevelSchema } from "../../domains/protocol.js";
import type { TRegisteredDomain } from "../../domains/resources.js";
import type { StepRegistry } from "../../steps/pipelines/step-registry.js";
import type { TFeature } from "./execution.js";
import type { AStepper } from "../../steps/domains/stepper.js";
import type { TActualityMachine } from "../machines/actuality.js";
import type { TLevelRecords } from "../pipelines/move-actuality.js";
import type { TClock } from "../ports.js";

export type TWorld = {
	tag: TTag;
	shared: FeatureVariables;
	runtime: TRuntime;
	prompter: Prompter;
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
	/** The clock of actuality's events and records, which actuality's composition root builds. */
	clock: TClock;
	bases: TBase;
	domains: Record<string, TRegisteredDomain>;
	eventLogger: IEventLogger;
};

export type TRuntime = {
	/** The id of the actuality that owns the records in the store. Each call to this instance after the handshake states
	 *  this id. A stepper whose store keeps its records across processes replaces this id with the id that the store holds. */
	actualityId: TActualityId;
	/** The levels of the execution: every lifecycle event of a level that actuality emits is a move of this machine. */
	actuality: TActualityMachine;
	/** The records of the execution's levels by their events' id. A level's end extends its start's record. */
	levels: TLevelRecords;
	/** Generic keyed store for subsystem runtime state. */
	keys?: Record<string, unknown>;
	backgrounds?: TFeature[];
	scenario?: string;
	feature?: string;
	/** Current feature file path (for dynamic statement execution) */
	currentFeaturePath?: string;
	/** The steps a reader can still read in full: the most recent the feature has run. */
	stepResults: TStepResult[];
	/** The reduction of the feature's steps so far: the count, the first start, the last end and the failed step. It is
	 *  updated as each step runs. */
	steps: TFeatureSteps;
	/** The last index allocated under each parent path, per direction. The next path under that parent counts from it. */
	seqPaths: Map<string, number>;
	/** Active steppers for this execution. Set by Executor, used by populateActionArgs / domain coercion. */
	steppers?: AStepper[];
	/** Shared step registry. Set by Executor, used for dynamic step registration. */
	stepRegistry?: StepRegistry;
	/** The cause of an exhaustion: a step depth or an ensure attempt count over its limit. While it is set, each dispatch
	 *  fails with this cause. */
	exhaustionError?: string;
	/**
	 * Monotonic counter for synthetic seqPaths. `allocateSyntheticSeqPath` in host-id.ts
	 * increments it for a call that doesn't carry a caller seqPath: an MCP tool call, an
	 * RPC without a seqPath, a step called by name, and an urakata registration.
	 * A synthetic path is [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq], so it sorts apart from
	 * every feature path.
	 */
	adHocSeq?: number;
	/** Each value a stepper holds for actuality under its own name, which `getFromRuntime` reads. */
	[name: string]: unknown;
};

/** Returns the steppers that execute actuality's steps. The Executor sets them before a step runs. */
export function runSteppers(world: TWorld): AStepper[] {
	if (!world.runtime.steppers) throw new Error("world.runtime.steppers is unset. The Executor sets it when it starts executing features, so call runSteppers after that.");
	return world.runtime.steppers;
}

/** Returns the value of an environment variable actuality declares, or undefined where it doesn't declare that name. */
export const runEnvVariable = (world: TWorld, name: string): string | undefined => world.options.envVariables?.[name];

/** Returns each environment variable actuality declares with its value: an empty list where it declares zero variables. */
export const runEnvEntries = (world: TWorld): [string, string][] => (world.options.envVariables === undefined ? [] : Object.entries(world.options.envVariables));

/** Actuality's base options from the environment. The schema is strict, so it rejects an option the cli declares and this
 *  schema doesn't, rather than dropping it. */
export const BaseOptionsSchema = z.strictObject({
	DEST: z.string(),
	KEY: z.string().optional(),
	DESCRIPTION: z.string().optional(),
	LOG_LEVEL: ShownLogLevelSchema.optional(),
	LOG_FOLLOW: z.string().optional(),
	STAY: z.string().optional(),
	SETTING: z.string().optional(),
	STEP_DELAY: z.number().optional(),
	/** Run a group only when one of its dependencies changed since it last passed. */
	ONCE: z.boolean().optional(),
	[CONTINUE_AFTER_ERROR]: z.boolean().optional(),
	/** Report actuality's events as NDJSON on stdout. */
	[NDJSON]: z.boolean().optional(),
	HOST_ID: z.number().optional(),
	PWDEBUG: z.string().optional(),
	envVariables: z.record(z.string(), z.string()).optional(),
});
export type TBaseOptions = z.infer<typeof BaseOptionsSchema>;

export type TEnvVariables = NonNullable<TBaseOptions["envVariables"]>;

export type TModuleOptions = { [name: string]: string };

export type TProtoOptions = { options: TBaseOptions; moduleOptions: TModuleOptions };

export type TBase = string[];
