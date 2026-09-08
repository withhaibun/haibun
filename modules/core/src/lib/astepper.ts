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

/** One stepper option declaration: the small, non-tunable shape every stepper has used. */
export type TStepperOption = {
	required?: boolean;
	altSource?: string;
	default?: string;
	/**
	 * Set when the option belongs to one process rather than to a run: a port it listens on, an identity it takes.
	 * A process that starts another does not pass these on, since the child would then take what the parent holds.
	 * The option declares it, so nothing else has to name the option to know it.
	 */
	perProcess?: boolean;
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

export type TFeatureStep = {
	in: string;
	seqPath: TSeqPath;
	action: TStepAction;
	source?: TSourceLocation["source"];
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
	/** True for dispatches that did not run a feature for a human — RPC, MCP, subprocess. Lifecycle hooks that would otherwise call `world.prompter.prompt()` skip when this is set. */
	programmatic?: boolean;
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
	/** A step that answers a question of the run's records and changes nothing. Invoked from outside the run, through
	 *  a call into a running instance, it is answered and not recorded: no step record, no announcement, no usage
	 *  count, no result kept. Reading a run is not an act of the run, and an instance read for a year is not made to
	 *  write a year of records of being read. From within a feature it is a step like any other. */
	read?: boolean;
	exposeMCP?: boolean;
	/** Optional capability label required for external dispatch. */
	capability?: string;
	/** Offer this step to a model before it discovers anything. A model is offered a small set at first, so that no
	 *  request pays for the whole manifest; a step marked here joins that set, because the question it answers is one
	 *  an operator can open with. Reserve it for steps that are the only way to do what they do. A predicate says
	 *  whether there is anything for it to answer right now: a step offered when it can only refuse is among the few a
	 *  model can see, so it is what the model reaches for, and the turn goes on refusing. */
	offeredBeforeDiscovery?: boolean | (() => boolean);
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
	 * Single-product postcondition. The step's action must return products matching
	 * the named domain's schema. The dispatcher auto-asserts the product as a typed
	 * fact, registers a producer edge in the resolver graph, and exposes the JSON
	 * Schema for discovery. Mutually exclusive with `productsDomains` and `productsSchema`.
	 */
	productsDomain?: string;
	/**
	 * Multi-product postconditions, keyed by product field. Each field's value must
	 * match its declared domain's schema. The dispatcher auto-asserts each as a typed
	 * fact and registers producer edges per field. Mutually exclusive with `productsDomain`
	 * and `productsSchema`.
	 */
	productsDomains?: Record<string, string>;
	/**
	 * Inline Zod schema for the step's products. The dispatcher validates against this
	 * schema and exposes the derived JSON Schema for discovery, but does NOT register a
	 * producer edge in the resolver graph and does NOT auto-assert facts. Use this for
	 * typed step outputs that are local to the step — handles, identifiers, or readouts
	 * with no shared semantics. Mutually exclusive with `productsDomain` and `productsDomains`.
	 */
	productsSchema?: z.ZodType;
	/**
	 * Which of the step's products are kept on its lifecycle event. Default (absent/true): all. `false`: none — for a step
	 * whose products are bulk payload consumed via the action result or a separate fetch (a query's rows, a captured page's
	 * HTML), which would otherwise bloat the in-memory event stream. A function: the subset it returns — for a product that
	 * mixes a small render descriptor (keep, so a view re-mounts on replay) with bulk payload (drop, retrieved live via the
	 * reference); return undefined to keep none.
	 */
	retainProducts?: boolean | ((products: Record<string, unknown>) => Record<string, unknown> | undefined);
};

export type TStepperStep = TStepperStepBase & {
	action(args: TStepArgs, featureStep?: TFeatureStep): Promise<TActionResult> | TActionResult;
};

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
