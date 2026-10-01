import { z } from "zod";
import type { TActualityId } from "./rpc-wire.js";
import type { TAnyFixme } from "./fixme.js";
import type { TTag } from "./ttag.js";
import type { FeatureVariables } from "./feature-variables.js";
import type { Prompter } from "./prompter.js";
import type { IEventLogger } from "./EventLogger.js";
import type { TStepResult, Timer, TFeatureSteps } from "../schema/protocol.js";
import { CONTINUE_AFTER_ERROR, NDJSON } from "../schema/protocol.js";
import type { TRegisteredDomain } from "./resources.js";
import type { StepRegistry } from "./step-registry.js";
import type { TFeature } from "./execution.js";
import type { AStepper } from "./astepper.js";

export type TWorld = {
	tag: TTag;
	shared: FeatureVariables;
	runtime: TRuntime;
	prompter: Prompter;
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
	timer: Timer;
	bases: TBase;
	domains: Record<string, TRegisteredDomain>;
	eventLogger: IEventLogger;
};

export type TRuntime = {
	/** The actuality the records actuality's store holds belong to, which every call to this instance states. A store
	 *  that keeps its records across processes replaces it with the one it keeps them under. */
	actualityId: TActualityId;
	/** Generic keyed store for subsystem runtime state. */
	keys?: Record<string, unknown>;
	backgrounds?: TFeature[];
	scenario?: string;
	feature?: string;
	/** Current feature file path (for dynamic statement execution) */
	currentFeaturePath?: string;
	/** The steps a reader can still read in full: the most recent the feature has run. */
	stepResults: TStepResult[];
	/** What the feature's steps have come to so far, reduced as they run. */
	steps?: TFeatureSteps;
	/** The last index allocated under each parent path, per direction: what the next path under it counts from. */
	seqPaths?: Map<string, number>;
	/** Active steppers for this execution. Set by Executor, used by populateActionArgs / domain coercion. */
	steppers?: AStepper[];
	/** Shared step registry. Set by Executor, used for dynamic step registration. */
	stepRegistry?: StepRegistry;
	/** If non-empty, execution was aborted due to exhaustion (description explains why). */
	exhaustionError?: string;
	/**
	 * Monotonic counter for synthetic seqPaths produced by external-protocol
	 * entry points (MCP) that don't have a caller seqPath to thread. See
	 * `syntheticSeqPath(hostId, adHocSeq)` in host-id.ts, synthetic paths
	 * are [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq] so they sort distinctly
	 * from any feature path. Internal dispatches (RPC, subprocess) now
	 * require the caller's seqPath instead of producing a synthetic.
	 */
	adHocSeq?: number;
	[name: string]: TAnyFixme;
};

/** The steppers the run executes with. The Executor sets them before a step runs. */
export function runSteppers(world: TWorld): AStepper[] {
	if (!world.runtime.steppers) throw new Error("world.runtime.steppers is unset: the Executor sets it before a step runs");
	return world.runtime.steppers;
}

/** The environment variables the run declares. A run that doesn't declare one doesn't have one. */
export function runEnvVariables(world: TWorld): TEnvVariables {
	return world.options.envVariables ?? {};
}

/** A run's base options, as the environment states them. Strict, so an option the cli declares and this doesn't is refused
 *  rather than dropped. */
export const BaseOptionsSchema = z.strictObject({
	DEST: z.string(),
	KEY: z.string().optional(),
	DESCRIPTION: z.string().optional(),
	LOG_LEVEL: z.string().optional(),
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

export type TProtoOptions = {
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
};

export type TBase = string[];
