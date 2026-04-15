import { AStepper } from "./astepper.js";
import { TAnyFixme } from "./fixme.js";
import { TTag } from "./ttag.js";
import { FeatureVariables } from "./feature-variables.js";
import { Prompter } from "./prompter.js";
import { IEventLogger } from "./EventLogger.js";
import { z } from "zod";
import {
	ExecutionIntent,
	TSeqPath,
	TStepResult,
	TFeatureResult,
	TExecutorResult,
	TStepArgs,
	TStepValueValue,
	TStepValue,
	Timer,
	THaibunEvent,
	TActionResult,
	CONTINUE_AFTER_ERROR,
} from "../schema/protocol.js";

// ============================================================================
// Core Execution World
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
	stepRegistry?: import("../lib/step-dispatch.js").StepRegistry;
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

export const RemoteStepperSchema = z.object({ remote: z.string(), token: z.string().optional() });
export type TRemoteStepper = z.infer<typeof RemoteStepperSchema>;

export const StepperEntrySchema = z.union([z.string(), RemoteStepperSchema]);
export type TStepperEntry = z.infer<typeof StepperEntrySchema>;

export const SpeclSchema = z.looseObject({
	$schema: z.string().optional(),
	steppers: z.array(StepperEntrySchema),
	runPolicy: z.string().optional(),
	appParameters: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
	options: z.record(z.string(), z.unknown()).optional(),
});

export type TSpecl = z.infer<typeof SpeclSchema>;

// ============================================================================
// Feature & Step Structures
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
// Stepper & Lifecycle
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

export interface IStepperWhen {
	startExecution?: number;
	startFeature?: number;
}

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

export const CycleWhen = {
	FIRST: -999,
	LAST: 999,
};

// ============================================================================
// Domains
// ============================================================================

export type TDomainCoercer = (proto: TStepValue, featureStep?: TFeatureStep, steppers?: AStepper[]) => TStepValueValue;
export type TDomainComparator = (value: TStepValueValue, baseline: TStepValueValue) => number;

/**
 * Link relation types — the canonical set of semantic rels for vertex properties and edges.
 * Declaration order determines column display priority in result tables.
 * `relation: true` marks rels that form conversational/threading links (used by getRelated, View relations).
 */
export const LinkRelations = {
	NAME: { rel: "name", uri: "as:name", relation: false },
	PUBLISHED: { rel: "published", uri: "as:published", relation: false },
	ATTRIBUTED_TO: { rel: "attributedTo", uri: "as:attributedTo", relation: false },
	AUDIENCE: { rel: "audience", uri: "as:to", relation: false },
	CONTEXT: { rel: "context", uri: "as:context", relation: false },
	UPDATED: { rel: "updated", uri: "as:updated", relation: false },
	CONTENT: { rel: "content", uri: "as:content", relation: false },
	IN_REPLY_TO: { rel: "inReplyTo", uri: "as:inReplyTo", relation: true },
	ATTACHMENT: { rel: "attachment", uri: "as:attachment", relation: false },
	TAG: { rel: "tag", uri: "as:tag", relation: false },
	IDENTIFIER: { rel: "identifier", uri: "dcterms:identifier", relation: false },
	URL: { rel: "url", uri: "as:url", relation: false },
} as const;

/**
 * Standard edge predicate names for graph vertices.
 * Each maps to a LinkRelation rel — multiple predicates can share the same rel.
 * Steppers use these as edge keys in getConcerns().edges and in createEdge() calls.
 */
export const EdgePredicates = {
	from: "from",
	to: "to",
	cc: "cc",
	author: "author",
	attachment: "attachment",
	inReplyTo: "inReplyTo",
	references: "references",
	annotates: "annotates",
} as const;

/** Domain name for vertex type labels — auto-populated from registered vertex domains. */
export const DOMAIN_VERTEX_LABEL = "vertex-label";

/** Rel values that are reply-type (derived from LinkRelations entries with relation: true). */
const relationRels: Set<string> = new Set(
	Object.values(LinkRelations)
		.filter((lr) => lr.relation)
		.map((lr) => lr.rel),
);

/** Check if a rel value is a reply-type (conversational/threading link). */
function isRelationRel(rel: string): boolean {
	return relationRels.has(rel);
}

/**
 * Check if an edge type (name or rel) is a reply-type link.
 * Uses the concern catalog's edge→rel mapping to resolve edge names to their rels.
 * Falls back to direct rel check if no catalog provided.
 */
export function isReplyEdge(edgeType: string, edgeRelMap?: Record<string, string>): boolean {
	if (isRelationRel(edgeType)) return true;
	if (edgeRelMap && edgeRelMap[edgeType]) return isRelationRel(edgeRelMap[edgeType]);
	return false;
}

export type TRel = (typeof LinkRelations)[keyof typeof LinkRelations]["rel"];

/** Property definition: either a rel string or a rel with mediaType for content fields. */
export type TPropertyDef = TRel | { rel: TRel; mediaType?: string };

/** Edge definition: semantic rel + range (the vertex type the edge points to). */
export type TEdgeDef = { rel: TRel; range: string };

/** JSON-LD context mapping: rel → standard URI. Derived from LinkRelations. */
export const REL_CONTEXT: Record<TRel, string> = Object.fromEntries(
	Object.values(LinkRelations).map(({ rel, uri }) => [rel, uri]),
) as Record<TRel, string>;

/** Hypermedia metadata for a vertex domain. One properties map drives everything. */
export type TVertexMeta = {
	vertexLabel: string;
	type?: string;
	id: string;
	properties: Record<string, TPropertyDef>;
	edges?: Record<string, TEdgeDef>;
	/** DB-specific: which properties to index for fast lookup. */
	propertyIndexes?: string[];
	/** DB-specific: default sort columns per property. */
	sortColumns?: Record<string, string>;
};

/** A vertex returned from graph operations, with routing metadata. */
export type TVertexResult = Record<string, unknown> & {
	_id: string;
	_label?: string;
	_inReplyTo?: string;
	_edges?: Array<{ type: string; targetId: string }>;
};

// --- Derived helpers for consumers ---

/** Get the rel for a property definition. */
export function getRel(def: TPropertyDef): TRel {
	return typeof def === "string" ? def : def.rel;
}

/** Get the mediaType for a content property, if any. */
export function getMediaType(def: TPropertyDef): string | undefined {
	return typeof def === "string" ? undefined : def.mediaType;
}

export type TDomainDefinition = {
	selectors: string[];
	schema: z.ZodType;
	coerce?: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
	/** Stepper that registered this domain (set automatically by registerDomains) */
	stepperName?: string;
	/** Hypermedia metadata for vertex domains. Undefined for non-vertex domains. */
	meta?: TVertexMeta;
};

export type TRegisteredDomain = {
	selectors: string[];
	schema: z.ZodType;
	coerce: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
	stepperName?: string;
	meta?: TVertexMeta;
};

// ============================================================================
// Misc
// ============================================================================

export type TOptionValue = TAnyFixme;
export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};
