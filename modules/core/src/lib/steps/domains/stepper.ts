/**
 * A stepper as haibun declares it: its steps, its options and its cycles, a step's shape and the feature step a line
 * resolves to, and the cycle methods a stepper may implement.
 */
import type { FeatureVariables } from "../../feature-variables.js";
import type { TWorld, TEnvVariables } from "../../world.js";
import type { TOptionValue, TFeatures, TSourceLocation } from "../../execution.js";
import type { ExecutionIntent, TSeqPath, TActionResult, TStepArgs, TStepValue, TStepResult, TFeatureResult, TExecutorResult, THaibunEvent } from "../../../schema/protocol.js";
import type { TDomainDefinition } from "../../resources.js";
import type { TStepReads } from "../../actions.js";
import type { IQuadStore } from "../ports.js";
import { constructorName } from "../../util/index.js";

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
	/** What the stepper's steps do. A caller that discovers actuality's steppers reads it beside the stepper's name. */
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
			throw Error(`${constructorName(this)} doesn't have a world. Call setWorld before getWorld.`);
		}

		return this.world;
	}

	/** Returns `value`, or throws where it is undefined. This stepper creates the value when setWorld runs. A flow runner
	 *  and the storage an option names are such values. */
	madeWithWorld<T>(value: T | undefined, what: string): T {
		if (value === undefined) throw new Error(`${constructorName(this)} creates its ${what} when setWorld runs, and setWorld hasn't run. Read the value after setWorld.`);
		return value;
	}

	/**
	 * The Resolver calls this before it resolves each feature. A stepper implements it to clear feature-scoped steps, so a
	 * step that one feature defines doesn't resolve in the next feature.
	 */
	startFeatureResolution?(_path: string): void;
}

export type TStepperSteps = { [key: string]: TStepperStep };

/** One stepper option declaration. Every stepper declares its options in this shape. */
export type TStepperOption = {
	required?: boolean;
	altSource?: string;
	default?: string;
	/**
	 * Set where each process takes its own value of the option. A listening port and an identity are such options. A
	 * process that starts another doesn't pass these options to the child, since the child would then take what the parent
	 * holds. The option declares this, so other code reads it without naming the option.
	 */
	perProcess?: boolean;
	desc: string;
	parse: (input: string, existing?: TOptionValue) => { parseError?: string; env?: TEnvVariables; result?: TOptionValue };
};

export interface IHasOptions {
	options?: { [name: string]: TStepperOption };
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

export type TResolvedFeature = { path: string; base: string; name: string; featureSteps: TFeatureStep[] };

export type TFeatureStep = {
	in: string;
	seqPath: TSeqPath;
	action: TStepAction;
	source?: TSourceLocation["source"];
	isSubStep?: boolean;
	/** True where an afterEvery hook triggered this step. It prevents a recursive afterEvery. */
	isAfterEveryStep?: boolean;
	intent?: ExecutionIntent;
	/** Runtime args for variable binding in nested quantifier calls. */
	runtimeArgs?: Record<string, string>;
	/**
	 * A routing hint. Dispatch resolves the tool of a step that sets it by the hostId-prefixed registry key
	 * `${targetHostId}:${method}`, and the step runs against that remote host. The composition step
	 * `on host {hostId}, {statement}` in haibun.ts sets it.
	 */
	targetHostId?: number;
	/** True for a dispatch that doesn't run a feature for a person. `buildFeatureStepForTransport` sets it for an RPC or MCP call. A lifecycle hook that would call `world.prompter.prompt()` skips the prompt where this is set. */
	programmatic?: boolean;
};

export type TStepAction = { actionName: string; stepperName: string; step: TStepperStep; stepValuesMap?: TStepValuesMap };

type TStepValuesMap = Record<string, TStepValue>;

// ============================================================================
// Stepper step shape
// ============================================================================

type TStepperStepBase = TStepReads & {
	description?: string;
	precludes?: string[];
	unique?: boolean;
	fallback?: boolean;
	/** A step whose result is the response of the turn that called it. That turn ends with the result and doesn't send its
	 *  model another request. A caller reads this flag from the step's definition, so it determines which steps end a turn
	 *  without running one. */
	answersTheTurn?: boolean;
	/** The read step that returns what this step changed. It is a step of the same stepper. A model's tool call returns that
	 *  read's result after this step runs, so the model doesn't request the read next. `answeredFor` in call-step.ts states
	 *  how a failed step combines with the read. */
	answeredBy?: string;
	/** Offers this step to a model before the model requests discovery. A request to a model lists a small set of steps
	 *  first, so it doesn't carry the whole manifest. A step marked here is in that set, because it serves a request that can
	 *  open a conversation. Mark only a step that is the only way to perform its operation. A predicate returns whether
	 *  the step has work to do at that moment. A step offered where it can only refuse is one of the few
	 *  steps a model reads, so the model calls it and the turn keeps receiving refusals. */
	offeredBeforeDiscovery?: boolean | (() => boolean);
	virtual?: boolean;
	/** Source location metadata for a generated step, such as a waypoint. */
	source?: { path: string; lineNumber?: number };
	match?: RegExp;
	gwta?: string;
	exact?: string;
	/** A prose line resolves to this step. The step doesn't declare a pattern. A line is prose where a step's pattern
	 *  doesn't match it and the line is a sentence or starts with a character other than a letter
	 *  (Resolver.findSingleStepAction). */
	prose?: boolean;
	resolveFeatureLine?(line: string, path: string, stepper: AStepper, backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string): boolean | void;
	/**
	 * Single-product postcondition. The step's action must return products that match the named domain's schema. The
	 * dispatcher asserts the product as a typed fact, registers a producer edge in the resolver graph, and exposes the
	 * JSON Schema for discovery. A step that returns products names their domain here or in `productsDomains`, and
	 * dispatch refuses products whose domain the step doesn't name.
	 */
	productsDomain?: string;
	/**
	 * Multi-product postconditions, keyed by product field. Each field's value must match its declared domain's schema.
	 * The dispatcher asserts each as a typed fact and registers a producer edge per field. Mutually exclusive with
	 * `productsDomain`.
	 */
	productsDomains?: Record<string, string>;
	/**
	 * The statement parameter whose products the step returns, for a step that runs a statement and returns that
	 * statement's products. Each line resolves its statement, and the products take the domain that the statement's last
	 * step names. The step doesn't name a domain of its own. Mutually exclusive with `productsDomain` and `productsDomains`.
	 */
	productsOf?: string;
	/**
	 * Maps each parameter that names a record by its id (`record-id`) to the parameter that names the record's type
	 * (`persisted-type` or `domain-key`). `get {label} {id}` declares `{ id: "label" }`. A step that takes two records
	 * names both.
	 */
	recordIds?: Record<string, string>;
	/**
	 * Maps each parameter that takes a record's fields to the parameter that names the record's type.
	 * `create {label} {data}` declares `{ data: "label" }`. The fields are those the named type's schema states, so a
	 * form renders an input for each field.
	 */
	recordData?: Record<string, string>;
	/**
	 * Which of the step's products its lifecycle event keeps. Absent or true keeps all of them. With `false` the event
	 * doesn't keep them. Set `false` for a step whose products are bulk payload that a caller reads from the action result
	 * or a separate fetch. A query's rows and a captured page's HTML are bulk payload. Keeping that payload would enlarge
	 * the in-memory event stream. A function keeps the subset it returns, for a product that mixes a small render
	 * descriptor with bulk payload. The event keeps the descriptor, so a view mounts again on replay, and a view reads the payload live
	 * through the reference. A function that returns undefined doesn't keep a product.
	 */
	retainProducts?: boolean | ((products: Record<string, unknown>) => Record<string, unknown> | undefined);
};

export type TStepperStep = TStepperStepBase & {
	/** Dispatch passes every action its arguments and the feature step being run. */
	action(args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> | TActionResult;
};

export interface CStepper {
	new (): AStepper;
}

// ============================================================================
// Cycle ordering
// ============================================================================

/** The position at which a stepper's cycle method runs among the steppers that implement it. A lower position runs first. */
export type IStepperWhen = { [K in keyof IStepperCycles]?: number };

/** The positions a stepper states in `cyclesWhen`. A stepper that doesn't state a position for a method runs at `UNSTATED`,
 *  between the first and the last. */
export const CycleWhen = { FIRST: -999, UNSTATED: 0, LAST: 999 } as const;

// ============================================================================
// Observation, concerns, cycles
// ============================================================================

/**
 * An observation source for the `observed in` quantifier pattern. It provides runtime metrics for one iteration and
 * doesn't store them.
 *
 * An implementation can read the quad store through `queryFacts`, so `observe` is async.
 */
export interface IObservationSource {
	name: string;
	observe(world: TWorld): Promise<{ items: string[]; metrics: Record<string, Record<string, unknown>> }>;
}

export interface IStepperConcerns {
	domains?: TDomainDefinition[];
	sources?: IObservationSource[];
	quadStore?: { store: IQuadStore; namedGraphs: string[] };
}

export interface IStepperCycles {
	getConcerns?(): IStepperConcerns;
	/** Returns registered outcome definitions for artifact emission. ActivitiesStepper calls it. */
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
	endExecution?(results: TEndExecution): Promise<void>;
	onEvent?(event: THaibunEvent): Promise<void> | void;
}

export type TStartExecution = TResolvedFeature[];
export type TEndFeature = { featurePath: string; shouldClose: boolean; isLast: boolean; okSoFar: boolean; continueAfterError: boolean; thisFeatureOK: boolean };
/** Actuality's result when its features end. `stays` is true where actuality keeps serving after them.
 *  `staysAfterExecution` computes it from `HAIBUN_STAY`. */
export type TEndExecution = TExecutorResult & { stays: boolean };
export type TStartFeature = { resolvedFeature: TResolvedFeature; index: number };
export type TStartScenario = { scopedVars: FeatureVariables };
export type TBeforeStep = { featureStep: TFeatureStep };
export type TAfterStep = { featureStep: TFeatureStep; actionResult: TActionResult };
/** A failed feature, and the step that failed where one did: a feature also fails on an error outside its steps. */
export type TFailureArgs = { featureResult: TFeatureResult; failedStep?: TStepResult };
/** The outcome an afterStep cycle returns for a step. `rerunStep` runs the step again, `nextStep` continues past its failure,
 *  and `failed` fails the step with the reason it holds. */
export type TAfterStepResult = { rerunStep?: boolean; nextStep?: boolean; failed?: string };

export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};
