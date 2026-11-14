/**
 * A stepper as haibun declares it: its steps, its options and its cycles, a step's shape and the feature step a line
 * resolves to, and the cycle methods a stepper may implement.
 */
import type { FeatureVariables } from "../../actuality/pipelines/feature-variables.js";
import type { TWorld, TEnvVariables } from "../../actuality/domains/world.js";
import type { TOptionValue, TFeatures, TSourceLocation, TStepInput } from "../../actuality/domains/actuality.js";
import type {
	TSeqPath,
	TActionResult,
	TStepArgs,
	TStepValue,
	TStepValueValue,
	TStepResult,
	TFeatureResult,
	TExecutorResult,
	THaibunEvent,
	TProvenanceIdentifier,
} from "../../domains/protocol.js";
import type { AccessLevel, TCoercionSite, TDomainDefinition } from "../../domains/resources.js";
import type { TStepReads } from "../../domains/actions.js";
import type { TListing, TListItem, TListQuery, TListStage } from "../../domains/lists.js";
import type { IQuadStore } from "../ports.js";
import type { TEntailment } from "../../records/domains/claim.js";
import type { TRelation, TStepContract } from "./contract.js";
import { constructorName } from "../../domains/util.js";
import { DOMAIN_TITLE, type DOMAIN_STRING, type DOMAIN_UNION, type DomainTypes } from "../../domains/domains.js";

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
	 * The Resolver calls this before it resolves each feature. A stepper implements it to select what applies in that feature,
	 * so a waypoint that one feature states doesn't apply in the next feature.
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

/** Returns the domains a stepper declares in its concerns, or an empty list where it doesn't declare cycles, concerns or domains. */
export function declaredDomains(stepper: AStepper): TDomainDefinition[] {
	const declared = hasCycles(stepper) ? stepper.cycles.getConcerns?.()?.domains : undefined;
	return declared === undefined ? [] : declared;
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
	/** The bindings of the statement a step is in: a quantifier's member, an item of `for each` and a waypoint's arguments, each a
	 *  variable within the statement. */
	runtimeArgs?: Record<string, string | number>;
	/** The item each member or item variable of `runtimeArgs` binds, whose fields the statement reads as `variable.field`. */
	boundItems?: Readonly<Record<string, TListItem>>;
	/**
	 * A routing hint. Dispatch resolves the tool of a step that sets it by the hostId-prefixed registry key
	 * `${targetHostId}:${method}`, and the step runs against that remote host. The composition step
	 * `on host {hostId}, {statement}` in haibun.ts sets it.
	 */
	targetHostId?: number;
	/** The list combinators whose statement this step ends, innermost first. The step returns its list as their listings make
	 *  it. A list combinator sets them on the last step of its statement, after its own. */
	listings?: readonly TListStage[];
	/** True for a dispatch that doesn't run a feature for a person. `buildFeatureStepForTransport` sets it for an RPC or MCP call. A lifecycle hook that would call `world.prompter.prompt()` skips the prompt where this is set. */
	programmatic?: boolean;
};

/** The site at which a feature step's values are coerced: its seqPath, the path of its feature, and the steppers. */
export const coercionSite = (featureStep: TFeatureStep, steppers: AStepper[]): TCoercionSite => ({ seqPath: featureStep.seqPath, path: featureStep.source?.path, steppers });

export type TStepAction = { actionName: string; stepperName: string; step: TStepperStep; stepValuesMap?: TStepValuesMap };

/** The provenance of a value a feature step sets: the step's line, its seqPath, and the step it called. */
export function provenanceFromFeatureStep(featureStep: TFeatureStep): TProvenanceIdentifier {
	return { in: featureStep.in, seq: featureStep.seqPath, when: `${featureStep.action.stepperName}.steps.${featureStep.action.actionName}` };
}

type TStepValuesMap = Record<string, TStepValue>;

// ============================================================================
// Stepper step shape
// ============================================================================

type TStepperStepBase = TStepReads & {
	description: string;
	/** The levels of the records the step writes, where a route calls it: with `readsAt`, the actions a route holds to call
	 *  it (`callStepAsRoute`). */
	writesAt?: AccessLevel[];
	/** A kaname step of the types it takes (Japanese: the rivet at the pivot of a fan, the vital point): a record's column shows
	 *  its type's kaname steps first, then its other applicable steps, and the actions bar and MCP list them first. A type has a
	 *  few. */
	kaname?: boolean;
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
	/** For a claim, what it checks, from its parameters' terms as its line states them: its reasoning task, its axiom and the
	 *  entailment, which a line's validation returns and the claim's result states. */
	entails?: (terms: ReadonlyMap<string, string>) => TEntailment;
	/** The predicate of the registry the step proves where its method doesn't name it: member_of, which a domain's membership proves. */
	predicate?: typeof PREDICATE.memberOf;
	/** Offers this step to a model before the model requests discovery. A request to a model lists a small set of steps
	 *  first, so it doesn't carry the whole manifest. A step marked here is in that set, because it serves a request that can
	 *  open a conversation. Mark only a step that is the only way to perform its operation. A predicate returns whether
	 *  the step has work to do at that moment. A step offered where it can only refuse is one of the few
	 *  steps a model reads, so the model calls it and the turn keeps receiving refusals. */
	offeredBeforeDiscovery?: boolean | (() => boolean);
	gwta?: string;
	exact?: string;
	/** Each rule whose head a line unifies with resolves the line to this step. The pattern of the rule's head parses the line,
	 *  and the step the line resolves to holds that rule. A step that states rules doesn't declare a pattern. */
	rules?: () => readonly TWaypointRule[];
	/** A prose line resolves to this step. The step doesn't declare a pattern. A line is prose where a step's pattern
	 *  doesn't match it and the line is a sentence or starts with a character other than a letter
	 *  (Resolver.findSingleStepAction). */
	prose?: boolean;
	resolveFeatureLine?(line: string, path: string, stepper: AStepper, backgrounds: TFeatures, allLines?: string[], lineIndex?: number, actualSourcePath?: string): boolean | void;
	/**
	 * What a call of the step produces (`contract.ts`). A step that returns products declares their domain, the domain of each
	 * product field, or the statement parameter whose products it returns. Dispatch asserts each product as a typed fact and
	 * refuses products whose domain the step doesn't name; the producer rules, discovery and the JSON Schema a step exposes read it.
	 */
	contract?: TStepContract;
	/**
	 * For a step that returns the products of its statement (`contract.products.of`), the listing its line's values state, which makes
	 * something of the list the domain of the statement's last step declares. Dispatch refuses a statement whose last step
	 * doesn't return a declared list, and the listing's refusal.
	 */
	transformsList?(values: TStepArgs): TListing;
	/** For a list combinator, the order, offset or limit its listing states, which a read that takes a list query applies at
	 *  its source in its place. */
	listQuery?(values: TStepArgs): TListQuery;
	/**
	 * For a step whose products domain declares a list, the arguments that read its list in the order, from the offset and to
	 * the limit a query states, so its source counts the whole list. Returns undefined where the step's arguments state a part
	 * of the query, since the query would replace it, and the listings then apply to the list the step reads.
	 */
	takesListQuery?(args: TStepArgs, query: TListQuery): TStepArgs | undefined;
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

/**
 * The formal readings the logic engine holds, by the step that declares each, with the engine's functor for it. A step
 * that declares a reading doesn't hold an action: the engine proves it from its statements.
 */
export const READING = {
	didnt: "not",
	where: "where",
	anyOf: "any_of",
	maybe: "maybe",
	some: "some",
	every: "every",
	whenever: "whenever",
	until: "until",
	ensure: "ensure",
	waypoint: "waypoint",
	apply: "apply",
	within: "within",
} as const;
export type TReading = (typeof READING)[keyof typeof READING];

/** The parameter in which a step that reads as until states how long it proves its statements again. */
export const UNTIL_DURATION = "duration";
/** The refusal of a line that reads as until without stating how long it proves its statements again. */
export const untilWithoutDuration = (line: string): string =>
	`\`${line}\` doesn't state how long to keep trying. Add a duration, such as \`within "5s"\`, to the line, and {${UNTIL_DURATION}} to its step's pattern where the pattern doesn't take one.`;

/** A scenario's heading. A heading that starts with the pending status, as `isPendingScenario` reads it, states a requirement
 *  the steppers don't provide yet. */
export const SCENARIO_HEADING = `(Pending )?Scenario: {scenario: ${DOMAIN_TITLE}}`;

/** The predicates of the registry that a step's method doesn't name: member_of(V, D), which a domain's membership step proves
 *  and a formula's guard states, and precedes(D, A, B), which holds where the order of an ordered domain D puts A before B. */
export const PREDICATE = { memberOf: "member_of", precedes: "precedes" } as const;

/** A waypoint's rule: its head as written and as the pattern that parses a goal, the lines of its proof, the lines of its
 *  activity, the plan that makes the proof hold, and the line that states it. A feature's rule applies in that feature alone,
 *  its `scope`, and a background's or a saved rule applies in every feature. Its `library` names where it is stated: the
 *  package whose background states it, the feature that states it, or `saved`. A rule over step records names the stepper
 *  whose steps it reads `after`: its proof is proved after each step of that stepper that a feature's line states. Its
 *  `description` states what it establishes: the title of the activity that states it, a saved waypoint's title, or the line
 *  of a universal rule or a rule over step records, which states the rule itself. */
export type TWaypointRule = {
	head: string;
	description: string;
	pattern: string;
	proof: TStepInput[];
	activity: TStepInput[];
	source: { path: string; lineNumber?: number };
	library: string;
	scope?: string;
	saved?: true;
	after?: string;
};

/** Where a rule is stated: its source path, and its line where the source states one. */
export const ruleStatedAt = ({ source }: TWaypointRule): string => (source.lineNumber === undefined ? source.path : `${source.path}:${source.lineNumber}`);

/** A step that a stepper's action performs. Dispatch passes the action its arguments and the feature step being run. */
type TActionStep = { action(args: TStepArgs, featureStep: TFeatureStep): Promise<TActionResult> | TActionResult; reading?: undefined; rule?: undefined; context?: undefined };
/** The context a step opens around each call of the statements it states, such as a narrowed authority or an element of a
 *  page: it runs a call inside the context and returns the call's result. */
export type TStepContext = <T>(run: () => Promise<T>) => Promise<T>;

/** A step that the logic engine proves by its reading. A waypoint's step holds its rule, and a step that reads as `within`
 *  opens its context from its arguments, or refuses with the reason it can't open it. */
type TReadingStep = {
	reading: TReading;
	rule?: TWaypointRule;
	context?: (args: TStepArgs, featureStep: TFeatureStep) => Promise<TStepContext | { refused: string }>;
	action?: undefined;
};

export type TStepperStep = TStepperStepBase & (TActionStep | TReadingStep);

// ============================================================================
// Typed step declaration
// ============================================================================

/** The text inside each pair of braces of a pattern, such as `what: variable-name`. */
type TPlaceholderTexts<P extends string> = P extends `${string}{${infer Inner}}${infer Rest}` ? Inner | TPlaceholderTexts<Rest> : never;
/** The text of the group that ends at a `)?`: the text after the last `(` before it. */
type TLastGroup<G extends string> = G extends `${string}(${infer Inner}` ? TLastGroup<Inner> : G;
/** The text of each optional group `(...)?` of a pattern. */
type TOptionalGroups<P extends string> = P extends `${string}(${infer Group})?${infer Rest}` ? TLastGroup<Group> | TOptionalGroups<Rest> : never;
/** A text with the spaces at its start and its end removed. */
type TTrimmed<S extends string> = S extends ` ${infer T}` ? TTrimmed<T> : S extends `${infer T} ` ? TTrimmed<T> : S;
/** A placeholder's name: its text before the colon, as `placeholderOf` in phrase.ts reads it. */
export type TPlaceholderName<I extends string> = TTrimmed<I extends `${infer N}:${string}` ? N : I>;
/** A placeholder's domain: its text after the colon, or `string` where the placeholder doesn't name one. */
export type TPlaceholderDomain<I extends string> = I extends `${string}:${infer D}` ? (TTrimmed<D> extends "" ? typeof DOMAIN_STRING : TTrimmed<D>) : typeof DOMAIN_STRING;
/**
 * The value an action receives for a parameter of a domain. A union domain's parameter receives the resolved TStepValue, since
 * the step selects its behaviour by the value's domain (`argumentsOf` in populate-action-args.ts). Every other parameter
 * receives the value its domain coerces, of the type the domain's DomainTypes entry states. A domain without an entry, or a
 * domain key that isn't a literal type, gives TStepValueValue.
 */
type TDomainValue<D extends string> = string extends D
	? TStepValueValue
	: D extends `${string}${typeof DOMAIN_UNION}${string}`
		? TStepValue
		: D extends keyof DomainTypes
			? DomainTypes[D]
			: TStepValueValue;
/** The placeholder texts of a pattern's optional groups. A line that leaves a group out doesn't state the group's parameters. */
type TOptionalTexts<P extends string> = TPlaceholderTexts<TOptionalGroups<P>>;
/** The placeholder texts every line of a pattern states: those outside its optional groups. */
export type TRequiredTexts<P extends string> = Exclude<TPlaceholderTexts<P>, TOptionalTexts<P>>;
/**
 * The arguments an action receives from its step's pattern: a property for each placeholder, by its name, of its domain's
 * value type. A placeholder inside an optional group is an optional property. A pattern without a literal type, such as one
 * a function builds, gives TStepArgs, as does a step without a pattern, whose pattern `declareSteps` infers as unknown.
 */
export type TArgsOf<P> = P extends string ? TArgsOfPattern<P> : TStepArgs;
type TArgsOfPattern<P extends string> = string extends P
	? TStepArgs
	: P extends `${string})?${string}`
		? TArgsOfTexts<TRequiredTexts<P>> & Partial<TArgsOfTexts<TOptionalTexts<P>>>
		: TArgsOfTexts<TPlaceholderTexts<P>>;
/** A property for each placeholder text, by its name, of its domain's value type. */
type TArgsOfTexts<I extends string> = { [Text in I as TPlaceholderName<Text>]: TDomainValue<TPlaceholderDomain<Text>> };
/** The arguments a step's `takesListQuery` returns `Q`, which dispatch passes to the action in place of the line's. A step
 *  that doesn't state one, whose `Q` is unknown, doesn't add any. */
type TListArgs<Q> = unknown extends Q ? never : Exclude<Q, undefined>;
/** The arguments an action receives: its pattern's, and those its `takesListQuery` adds, which are absent where a list
 *  combinator doesn't state a query. */
type TActionArgs<P, Q> = unknown extends Q ? TArgsOf<P> : TArgsOf<P> & Partial<TListArgs<Q>>;
/** A step whose action receives the arguments its pattern `P` types, with those its `takesListQuery` adds. */
type TDeclaredAction<P, Q> = {
	takesListQuery?: (args: TArgsOf<P>, query: TListQuery) => (TListArgs<Q> & TStepArgs) | undefined;
	action: (args: TActionArgs<P, Q>, featureStep: TFeatureStep) => Promise<TActionResult> | TActionResult;
	reading?: undefined;
	rule?: undefined;
	context?: undefined;
};
/** A step as `declareSteps` takes it: its pattern `P`, as a gwta or an exact line, and an action typed by that pattern, or a reading. */
export type TDeclaredStep<P, Q = unknown> = Omit<TStepperStepBase, "takesListQuery"> & { gwta?: P; exact?: P } & (TDeclaredAction<P, Q> | TReadingStep);
/** A stepper's steps as `declareSteps` returns them, each by its name with its pattern `T[K]` and its list arguments `Q[K]`. */
export type TDeclaredSteps<T extends Record<string, unknown>, Q = Record<never, never>> = { [K in keyof T]: TDeclaredStep<T[K], K extends keyof Q ? Q[K] : unknown> };
/** The list arguments each step's `takesListQuery` returns, by the step's name. */
type TListArgsOf<Q> = { [K in keyof Q]: { takesListQuery?: (args: never, query: TListQuery) => Q[K] } };

/**
 * Declares a stepper's steps. Each step's pattern is read as its literal type `T[K]`, and its action's arguments are typed from
 * the pattern's placeholders, so an action that reads a parameter its pattern doesn't state, or reads it as another type,
 * doesn't compile. TypeScript infers `T` from the patterns alone, since a pattern inferred with the rest of its step widens to
 * string. A step without a pattern, such as a prose step, doesn't give TypeScript a pattern to infer, so `T` admits unknown for it. `Q`
 * is what each `takesListQuery` returns, which its action also receives. TypeScript infers it where `takesListQuery` states
 * its parameters' types, and checks those types against the pattern. `S` is each step as written, so a caller reads a step's
 * action, or its reading, by the step's name. An exact line doesn't state placeholders, so its action receives `{}`.
 */
export const declareSteps = <const T extends Record<string, unknown>, Q, S extends Record<keyof T, object>>(
	steps: TDeclaredSteps<T, Q> & TListArgsOf<Q> & S,
): TDeclaredSteps<T, Q> & S => steps;

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

export interface IStepperConcerns {
	domains?: TDomainDefinition[];
	/** The relations the stepper's contract statements share, each declared once. */
	relations?: TRelation[];
	quadStore?: { store: IQuadStore; namedGraphs: string[] };
}

export interface IStepperCycles {
	getConcerns?(): IStepperConcerns;
	startActuality?(features: TStartActuality): Promise<void> | void;
	startFeature?(startFeature: TStartFeature): Promise<void> | void;
	startScenario?(startScenario: TStartScenario): Promise<void>;
	beforeStep?(beforeStep: TBeforeStep): Promise<void>;
	/** A stepper that doesn't change how the step ends returns undefined. */
	afterStep?(afterStep: TAfterStep): Promise<TAfterStepResult | undefined>;
	endScenario?(): Promise<void>;
	endFeature?(endedWith: TEndFeature): Promise<void>;
	onFailure?(result: TFailureArgs): Promise<void>;
	endActuality?(results: TEndActuality): Promise<void>;
	onEvent?(event: THaibunEvent): Promise<void> | void;
}

export type TStartActuality = TResolvedFeature[];
export type TEndFeature = { featurePath: string; shouldClose: boolean; isLast: boolean; okSoFar: boolean; continueAfterError: boolean; thisFeatureOK: boolean };
/** Actuality's result when its features end. `stays` is true where actuality keeps serving after them.
 *  `staysAfterActuality` computes it from `HAIBUN_STAY`. */
export type TEndActuality = TExecutorResult & { stays: boolean };
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
