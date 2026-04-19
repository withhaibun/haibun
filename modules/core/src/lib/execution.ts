/**
 * Execution — how the haibun runtime drives features, scenarios, and steps.
 *
 * Answers "what is the world at runtime, how are features structured, and what is a stepper's lifecycle?"
 * Pure type declarations — browser-safe. All runtime behavior lives in the phases/* and lib/core/*
 * implementations; this file only holds the shapes those implementations use.
 *
 * Contents:
 *   - World/runtime: TWorld, TRuntime, options
 *   - Features: TFeature, TFeatureStep, TResolvedFeature, source locations
 *   - Steppers: CStepper, IStepperCycles, IStepperWhen, IStepperConcerns, TStepperStep
 *   - Lifecycle args: TStartFeature, TEndFeature, TBeforeStep, TAfterStep, …
 *   - CycleWhen: ordering hints for cycle execution
 *   - IObservationSource, IRouteRegistry: runtime-plug interfaces
 *
 * Resource vocabulary (topology, rels, access, etc.) lives in resources.ts — import from there.
 */
import type { z } from "zod";
import { z as zr } from "zod";

import type { AStepper } from "./astepper.js";
import type { TAnyFixme } from "./fixme.js";
import type { TTag } from "./ttag.js";
import type { FeatureVariables } from "./feature-variables.js";
import type { Prompter } from "./prompter.js";
import type { IEventLogger } from "./EventLogger.js";
import type {
	ExecutionIntent,
	TSeqPath,
	TStepResult,
	TFeatureResult,
	TExecutorResult,
	TStepArgs,
	TStepValue,
	Timer,
	THaibunEvent,
	TActionResult,
} from "../schema/protocol.js";
import { CONTINUE_AFTER_ERROR } from "../schema/protocol.js";

import type { TDomainDefinition, TRegisteredDomain } from "./resources.js";

// ============================================================================
// World / runtime
// ============================================================================

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
	stepRegistry?: import("./step-dispatch.js").StepRegistry;
	/** Generic storage for observation data, cleared between features */
	observations: Map<string, TAnyFixme>;
	/** If non-empty, execution was aborted due to exhaustion (description explains why). */
	exhaustionError?: string;
	/** Monotonic counter for ad-hoc RPC calls (not part of feature execution). Gives seqPath [0, N]. */
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

// ============================================================================
// Specl (runtime config file)
// ============================================================================

export const RemoteStepperSchema = zr.object({ remote: zr.string(), token: zr.string().optional() });
export type TRemoteStepper = z.infer<typeof RemoteStepperSchema>;

export const StepperEntrySchema = zr.union([zr.string(), RemoteStepperSchema]);
export type TStepperEntry = z.infer<typeof StepperEntrySchema>;

export const SpeclSchema = zr.looseObject({
	$schema: zr.string().optional(),
	steppers: zr.array(StepperEntrySchema),
	runPolicy: zr.string().optional(),
	appParameters: zr.record(zr.string(), zr.record(zr.string(), zr.unknown())).optional(),
	options: zr.record(zr.string(), zr.unknown()).optional(),
});

export type TSpecl = z.infer<typeof SpeclSchema>;

// ============================================================================
// Feature & Step structures
// ============================================================================

export type TFeatureMeta = {
	base: string;
	name: string;
	path: string;
};

export type TFeature = TFeatureMeta & {
	content: string;
	/** For kireji files: maps BDD line number (1-indexed) to TypeScript step index (0-indexed) */
	kirejiLineMap?: Map<number, number>;
};

export type TFeatures = TFeature[];

export type TExpandedFeature = TFeatureMeta & {
	expanded: TExpandedLine[];
};

export type TExpandedLine = {
	line: string;
	rawLine?: string;
	lineNumber?: number;
	feature: TFeature;
};

export interface TSourceLocation {
	source: {
		/** Absolute path to the source file */
		path: string;
		/** 1-indexed line number in the source file */
		lineNumber?: number;
	};
}

/** A statement with its source location */
export type TStepInput = TSourceLocation & {
	in: string;
};

export type TResolvedFeature = {
	path: string;
	base: string;
	name: string;
	featureSteps: TFeatureStep[];
};

export type TFeatureStep = TSourceLocation & {
	in: string;
	seqPath: TSeqPath;
	action: TStepAction;
	isSubStep?: boolean;
	/** True if this step was triggered by an afterEvery hook (prevents recursive afterEvery) */
	isAfterEveryStep?: boolean;
	intent?: ExecutionIntent;
	/** Runtime args for variable binding in nested quantifier calls */
	runtimeArgs?: Record<string, string>;
};

export type TStepAction = {
	actionName: string;
	stepperName: string;
	step: TStepperStep;
	stepValuesMap?: TStepValuesMap;
};

export type TStepValuesMap = Record<string, TStepValue>;

// ============================================================================
// Stepper step shape
// ============================================================================

type TStepperStepBase = {
	handlesUndefined?: true | string[];
	description?: string;
	precludes?: string[];
	unique?: boolean;
	fallback?: boolean;
	exposeMCP?: boolean;
	/** Optional capability label required for external dispatch. */
	capability?: string;
	virtual?: boolean;
	/** For dynamically generated steps (like waypoints): source location metadata */
	source?: {
		path: string;
		lineNumber?: number;
	};
	match?: RegExp;
	gwta?: string;
	exact?: string;
	resolveFeatureLine?(
		line: string,
		path: string,
		stepper: AStepper,
		backgrounds: TFeatures,
		allLines?: string[],
		lineIndex?: number,
		actualSourcePath?: string,
	): boolean | void;
};

/** Step that declares an output schema — action MUST return products on success. */
type TStepperStepWithProducts = TStepperStepBase & {
	outputSchema: z.ZodType;
	action(args: TStepArgs, featureStep?: TFeatureStep): Promise<TActionResult> | TActionResult;
};

/** Step without output schema — no products on success. */
type TStepperStepPlain = TStepperStepBase & {
	outputSchema?: undefined;
	action(args: TStepArgs, featureStep?: TFeatureStep): Promise<TActionResult> | TActionResult;
};

export type TStepperStep = TStepperStepWithProducts | TStepperStepPlain;

export interface CStepper {
	new (): AStepper;
}

// ============================================================================
// Cycle ordering
// ============================================================================

export interface IStepperWhen {
	startExecution?: number;
	startFeature?: number;
	endFeature?: number;
}

export const CycleWhen = {
	FIRST: -999,
	LAST: 999,
};

// ============================================================================
// Observation, concerns, cycles
// ============================================================================

/**
 * Observation source for the 'observed in' quantifier pattern.
 * Provides ephemeral iteration over runtime metrics.
 */
export interface IObservationSource {
	name: string;
	observe(world: TWorld): {
		items: string[];
		metrics: Record<string, Record<string, unknown>>;
	};
}

export interface IStepperConcerns {
	domains?: TDomainDefinition[];
	sources?: IObservationSource[];
	quadStore?: { store: import("./quad-types.js").IQuadStore; namedGraphs: string[] };
}

export interface IStepperCycles {
	getConcerns?(): IStepperConcerns;
	/** Return registered outcome definitions for artifact emission. Used by ActivitiesStepper. */
	getRegisteredOutcomes?(): Record<string, unknown>;
	startExecution?(features: TStartExecution): Promise<void> | void;
	startFeature?(startFeature: TStartFeature): Promise<void> | void;
	startScenario?(startScenario: TStartScenario): Promise<void>;
	beforeStep?(beforeStep: TBeforeStep): Promise<void>;
	afterStep?(afterStep: TAfterStep): Promise<TAfterStepResult>;
	endScenario?(): Promise<void>;
	endFeature?(endedWith?: TEndFeature): Promise<void>;
	onFailure?(result: TFailureArgs): Promise<void>;
	endExecution?(results: TExecutorResult): Promise<void>;
	onEvent?(event: THaibunEvent): Promise<void> | void;
}

export type TStartExecution = TResolvedFeature[];
export type TEndFeature = {
	featurePath: string;
	shouldClose: boolean;
	isLast: boolean;
	okSoFar: boolean;
	continueAfterError: boolean;
	stayOnFailure: boolean;
	thisFeatureOK: boolean;
};
export type TStartFeature = { resolvedFeature: TResolvedFeature; index: number };
export type TStartScenario = { scopedVars: FeatureVariables };
export type TBeforeStep = { featureStep: TFeatureStep };
export type TAfterStep = { featureStep: TFeatureStep; actionResult: TActionResult };
export type TFailureArgs = { featureResult: TFeatureResult; failedStep: TStepResult };
export type TAfterStepResult = { rerunStep?: boolean; nextStep?: boolean; failed: boolean };

export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};

// ============================================================================
// Vertex query result (runtime read shape with routing metadata)
// ============================================================================

/** A vertex returned from graph operations, with routing metadata. */
export type TVertexResult = Record<string, unknown> & {
	_id: string;
	_label?: string;
	_inReplyTo?: string;
	_edges?: Array<{ type: string; targetId: string }>;
};

// ============================================================================
// Route registry (tiny cross-concern contract)
// ============================================================================

/** Minimal route registry interface — implemented by IWebServer, consumed by http-observations. */
export interface IRouteRegistry {
	readonly mounted: Record<string, Record<string, string>>;
}

/** Extract all registered route paths from a route registry. */
export function registeredPaths(registry: IRouteRegistry): Set<string> {
	return new Set(Object.values(registry.mounted).flatMap((m) => Object.keys(m)));
}

// ============================================================================
// Misc
// ============================================================================

export type TOptionValue = TAnyFixme;
