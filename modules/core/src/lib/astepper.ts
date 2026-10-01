import type { TAnyFixme } from "./fixme.js";
import type { FeatureVariables } from "./feature-variables.js";
import type { TWorld, TEnvVariables } from "./world.js";
import type { TOptionValue, TFeatures, TSourceLocation } from "./execution.js";
import type { ExecutionIntent, TSeqPath, TActionResult, TStepArgs, TStepValue, TStepResult, TFeatureResult, TExecutorResult, THaibunEvent } from "../schema/protocol.js";
import type { AccessLevel, TDomainDefinition } from "./resources.js";
import type { IQuadStore } from "./quad-types.js";
import { constructorName } from "./util/index.js";

export const StepperKinds = {
	MONITOR: "MONITOR",
	STORAGE: "STORAGE",
	BROWSER: "BROWSER",
	SERVER: "SERVER",
	TEST: "TEST",
	/** Taiwa-bridge: exposes `ask(prompt, opts?): Promise<string>`. */
	TAIWA: "TAIWA",
} as const;

type TStepperKind = keyof typeof StepperKinds;

export abstract class AStepper {
	/** What the stepper's steps do, as a caller discovering actuality reads it beside the stepper's name. */
	abstract description: string;
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

	/** A value this stepper makes when its world is set, such as a runner or the storage an option names. Reading it
	 *  before then is a fault. */
	madeWithWorld<T>(value: T | undefined, what: string): T {
		if (value === undefined) throw new Error(`${constructorName(this)} reads its ${what} once its world is set, and it isn't set`);
		return value;
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
	 * The option declares it, so other code doesn't have to name the option to read it.
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

/** A stepper declares cycles when it has a `cycles` object. */
export function hasCycles(stepper: AStepper): stepper is AStepper & IHasCycles {
	return "cycles" in stepper && typeof stepper.cycles === "object" && stepper.cycles !== null;
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
	 * hostId-prefixed registry key (`${targetHostId}:${method}`): the
	 * step runs against that remote host. Set by composition verbs like
	 * `on host {hostId} {statement}` in haibun.ts.
	 */
	targetHostId?: number;
	/** True for dispatches that did not run a feature for a human, RPC, MCP, subprocess. Lifecycle hooks that would otherwise call `world.prompter.prompt()` skip when this is set. */
	programmatic?: boolean;
};

export type TStepAction = {
	actionName: string;
	stepperName: string;
	step: TStepperStep;
	stepValuesMap?: TStepValuesMap;
};

type TStepValuesMap = Record<string, TStepValue>;

// ============================================================================
// Stepper step shape
// ============================================================================

type TStepperStepBase = {
	description?: string;
	precludes?: string[];
	unique?: boolean;
	fallback?: boolean;
	/** A step that reads actuality's records and doesn't change one. Invoked from outside actuality, through
	 *  a call into a running instance, it is answered and not recorded: it doesn't leave a step record, an announcement, a usage
	 *  count or a kept result. Reading a run is not an act of the run, and an instance read for a year is not made to
	 *  write a year of records of being read. From within a feature it is a step like any other. */
	read?: boolean;
	/** The action a caller must hold to run this step, where it is not the step's own: a group of steps declares one
	 *  action so a delegation can name them together. A step that doesn't declare one requires `Read:public` if it declares
	 *  itself a read, and otherwise its own name (actions.ts). */
	capability?: string;
	/** The level of what the step reads, where it reads more than records the caller's read bounds: a step reading a
	 *  person's own page reads at private. A caller whose read is narrower is refused the step. */
	readsAt?: AccessLevel;
	/** A step whose result answers the turn that called it, so that turn ends with it rather than asking its model
	 *  again. A caller reads this from the step's definition, so which steps end a turn is known without running one. */
	answersTheTurn?: boolean;
	/** The read, a step of the same stepper, that answers a caller who reads what this step changed: a model's tool call is
	 *  answered with it once the step passes, so it doesn't make that read next. */
	answeredBy?: string;
	/** Offer this step to a model before it discovers anything. A model is offered a small set at first, so that a
	 *  request doesn't carry the whole manifest; a step marked here joins that set, because the question it answers is one
	 *  an operator can open with. Reserve it for steps that are the only way to do what they do. A predicate reports
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
	/** A prose line resolves to this step, which doesn't declare a pattern: a line written as a sentence, or a line that starts
	 *  with a character other than a letter and that the steps' patterns don't match (Resolver.findSingleStepAction). */
	prose?: boolean;
	resolveFeatureLine?(line: string, path: string, stepper: AStepper, backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string): boolean | void;
	/**
	 * Single-product postcondition. The step's action must return products matching
	 * the named domain's schema. The dispatcher auto-asserts the product as a typed
	 * fact, registers a producer edge in the resolver graph, and exposes the JSON
	 * Schema for discovery. A step that returns products names their domain here or in
	 * `productsDomains`, and dispatch refuses products whose domain it doesn't name.
	 */
	productsDomain?: string;
	/**
	 * Multi-product postconditions, keyed by product field. Each field's value must
	 * match its declared domain's schema. The dispatcher auto-asserts each as a typed
	 * fact and registers producer edges per field. Mutually exclusive with `productsDomain`.
	 */
	productsDomains?: Record<string, string>;
	/**
	 * The statement parameter whose products the step answers with, for a step that runs a statement and passes on what
	 * it answered. Their domain is the one that statement's last step names, as each line resolves it, so the step doesn't name
	 * one of its own. Mutually exclusive with `productsDomain` and `productsDomains`.
	 */
	productsOf?: string;
	/**
	 * Each parameter naming a record by its id (`record-id`), with the parameter naming the record's type
	 * (`persisted-type` or `domain-key`): `{ id: "label" }` for `get {label} {id}`. A step taking two records names both.
	 */
	recordIds?: Record<string, string>;
	/**
	 * Which of the step's products are kept on its lifecycle event. Default (absent/true): all. `false`: the event doesn't keep them, for a step
	 * whose products are bulk payload consumed via the action result or a separate fetch (a query's rows, a captured page's
	 * HTML), which would otherwise bloat the in-memory event stream. A function: the subset it returns, for a product that
	 * mixes a small render descriptor (keep, so a view re-mounts on replay) with bulk payload (drop, retrieved live via the
	 * reference); return undefined so the event doesn't keep one.
	 */
	retainProducts?: boolean | ((products: Record<string, unknown>) => Record<string, unknown> | undefined);
};

export type TStepperStep = TStepperStepBase & {
	/** Dispatch calls every action with the step it runs as. */
	action(args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> | TActionResult;
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
	/** A stepper that doesn't change how the step ends returns undefined. */
	afterStep?(afterStep: TAfterStep): Promise<TAfterStepResult | undefined>;
	endScenario?(): Promise<void>;
	endFeature?(endedWith: TEndFeature): Promise<void>;
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
/** A failed feature, and the step that failed where one did: a feature also fails on an error outside its steps. */
export type TFailureArgs = { featureResult: TFeatureResult; failedStep?: TStepResult };
/** What an afterStep cycle decides of a step: to run it again, to move on past its failure, or to fail it, stating why. */
export type TAfterStepResult = { rerunStep?: boolean; nextStep?: boolean; failed?: string };

export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};
