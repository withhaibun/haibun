import type { TAnyFixme } from "./fixme.js";
import type { TTag } from "./ttag.js";
import type { FeatureVariables } from "./feature-variables.js";
import type { Prompter } from "./prompter.js";
import type { IEventLogger } from "./EventLogger.js";
import type { TStepResult, Timer } from "../schema/protocol.js";
import { CONTINUE_AFTER_ERROR } from "../schema/protocol.js";
import type { TRegisteredDomain } from "./resources.js";
import type { StepRegistry } from "./step-dispatch.js";
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
	backgrounds?: TFeature[];
	scenario?: string;
	feature?: string;
	/** Current feature file path (for dynamic statement execution) */
	currentFeaturePath?: string;
	stepResults: TStepResult[];
	/** Active steppers for this execution. Set by Executor, used by populateActionArgs / domain coercion. */
	steppers?: AStepper[];
	/** Shared step registry. Set by Executor, used for dynamic step registration. */
	stepRegistry?: StepRegistry;
	/** Generic storage for observation data, cleared between features */
	observations: Map<string, TAnyFixme>;
	/** If non-empty, execution was aborted due to exhaustion (description explains why). */
	exhaustionError?: string;
	/**
	 * The seqPath of the step currently executing, formatted as "0.1.2.10".
	 * Set by dispatchStep around the action invocation; read by emission
	 * sites that want to link their writes back to the originating step.
	 * Use the helper `linkToCurrentSeqPath` from step-dispatch.js rather
	 * than reading this directly.
	 */
	currentSeqPath?: string;
	/**
	 * Monotonic counter for synthetic seqPaths produced by external-protocol
	 * entry points (MCP) that have no caller seqPath to thread. See
	 * `syntheticSeqPath(hostId, adHocSeq)` in host-id.ts — synthetic paths
	 * are [hostId, SYNTHETIC_FEATURE_NUM, adHocSeq] so they sort distinctly
	 * from any feature path. Internal dispatches (RPC, subprocess) now
	 * require the caller's seqPath instead of producing a synthetic.
	 */
	adHocSeq?: number;
	[name: string]: TAnyFixme;
};

export type TBaseOptions = {
	DEST: string;
	KEY?: string;
	DESCRIPTION?: string;
	LOG_LEVEL?: string;
	LOG_FOLLOW?: string;
	STAY?: string;
	SETTING?: string;
	STEP_DELAY?: number;
	[CONTINUE_AFTER_ERROR]?: boolean;
	envVariables?: TEnvVariables;
};

export type TEnvVariables = {
	[name: string]: string;
};

export type TModuleOptions = { [name: string]: string };

export type TProtoOptions = {
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
};

export type TBase = string[];
