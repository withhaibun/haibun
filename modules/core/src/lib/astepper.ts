import type { z } from "zod";

import type { TAnyFixme } from "./fixme.js";
import type { FeatureVariables } from "./feature-variables.js";
import type { TWorld, TEnvVariables } from "./world.js";
import type { TOptionValue, TFeatures, TSourceLocation } from "./execution.js";
import type { ExecutionIntent, TSeqPath, TActionResult, TStepArgs, TStepValue, TStepResult, TFeatureResult, TExecutorResult, THaibunEvent } from "../schema/protocol.js";
import type { TDomainDefinition } from "./resources.js";
import type { IQuadStore } from "./quad-types.js";
import { constructorName } from "./util/index.js";

export const StepperKinds = {
	MONITOR: "MONITOR",
	STORAGE: "STORAGE",
	BROWSER: "BROWSER",
	SERVER: "SERVER",
	TEST: "TEST",
	/** Taiwa-bridge — exposes `ask(prompt, opts?): Promise<string>`. */
	TAIWA: "TAIWA",
} as const;

export type TStepperKind = keyof typeof StepperKinds;

export abstract class AStepper {
	description?: string;
	world?: TWorld;
	kind?: TStepperKind;

	setWorld(world: TWorld, _steppers: AStepper[]): Promise<void> {
		this.world = world;
		return Promise.resolve();
	}
	abstract steps: TStepperSteps;
	getWorld() {
		if (!this.world) {
			throw Error(`stepper without world ${constructorName(this)}`);
		}

		return this.world;
	}

	/**
	 * Called by Resolver before resolving each feature.
	 * Steppers can override to clear feature-scoped steps that shouldn't leak between features.
	 */
	startFeatureResolution?(_path: string): void;
}

export type TStepperSteps = {
	[key: string]: TStepperStep;
};

/** One stepper option declaration — the small, non-tunable shape every stepper has used. */
export type TStepperOption = {
	required?: boolean;
	altSource?: string;
	default?: string;
	desc: string;
	parse: (input: string, existing?: TOptionValue) => { parseError?: string; env?: TEnvVariables; result?: TAnyFixme };
};

export interface IHasOptions {
	options?: {
		[name: string]: TStepperOption;
	};
}

export interface IHasCycles {
	cycles: IStepperCycles;
	cyclesWhen?: IStepperWhen;
}

// ============================================================================
// Resolved feature & step (stepper-protocol shapes)
// ============================================================================

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
	/**
	 * Routing hint: when set, dispatch resolves the tool via the
	 * hostId-prefixed registry key (`${targetHostId}:${method}`) — the
	 * step runs against that remote host. Set by composition verbs like
	 * `on host {hostId} {statement}` in haibun.ts.
	 */
	targetHostId?: number;
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
	resolveFeatureLine?(line: string, path: string, stepper: AStepper, backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string): boolean | void;
	/**
	 * Per-parameter typed-fact preconditions. Maps gwta param names to domain keys.
	 * The dispatcher checks each declared input domain has at least one matching fact
	 * (or the gwta-resolved value validates against the domain's schema) before firing.
	 * Cross-checked against gwta-derived param-domain bindings at registration; mismatch
	 * is a registration error.
	 */
	inputDomains?: Record<string, string>;
	/**
	 * Single-product postcondition. The step's action must return products that match
	 * the named domain's schema; the dispatcher auto-asserts the product as a typed fact.
	 * Mutually exclusive with `outputDomains`.
	 */
	outputDomain?: string;
	/**
	 * Multi-product postconditions, keyed by product field. Each field's value must
	 * match its declared domain's schema; the dispatcher auto-asserts each as a typed
	 * fact. Mutually exclusive with `outputDomain`.
	 */
	outputDomains?: Record<string, string>;
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
 *
 * Implementations may read from the quad store via `queryFacts` (async). The
 * `observe` method is async to allow that.
 */
export interface IObservationSource {
	name: string;
	observe(world: TWorld): Promise<{
		items: string[];
		metrics: Record<string, Record<string, unknown>>;
	}>;
}

export interface IStepperConcerns {
	domains?: TDomainDefinition[];
	sources?: IObservationSource[];
	quadStore?: { store: IQuadStore; namedGraphs: string[] };
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
