import { AStepper } from './astepper.js';
import { TAnyFixme } from './fixme.js';
import { TTag } from './ttag.js';
import { FeatureVariables } from './feature-variables.js';
import { Prompter } from './prompter.js';
import { IEventLogger } from './EventLogger.js';
import type { ZodTypeAny } from 'zod';
import {
	ExecutionIntent,
	TSeqPath,
	TStepResult,
	TFeatureResult,
	TExecutorResult,
	TStepActionResult,
	TStepArgs,
	TStepValueValue,
	TStepValue,
	Timer,
	THaibunEvent,
	TActionResult,
	CONTINUE_AFTER_ERROR,
} from '../schema/protocol.js';

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
	stepResults: TStepResult[];
	/** If non-empty, execution was aborted due to exhaustion (description explains why). */
	exhaustionError?: string;
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
	envVariables?: TEnvVariables
};

export type TEnvVariables = {
	[name: string]: string;
}

export type TModuleOptions = { [name: string]: string };

export type TProtoOptions = {
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
};

export type TBase = string[];

export type TSpecl = {
	steppers: string[];
	refs?: {
		docs: { [name: string]: { src: string } };
	};
};

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

export type TStepperStep = {
	handlesUndefined?: true | string[];
	description?: string;
	precludes?: string[];
	unique?: boolean;
	fallback?: boolean;
	expose?: boolean;
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
	action(args: TStepArgs, featureStep?: TFeatureStep): Promise<TActionResult> | TActionResult;
}

export interface CStepper {
	new(): AStepper;
}

export interface IStepperWhen {
	startExecution?: number;
	startFeature?: number;
}

export interface IStepperCycles {
	getDomains?(): TDomainDefinition[];
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
export type TEndFeature = { shouldClose: boolean, isLast: boolean, okSoFar: boolean, continueAfterError: boolean, stayOnFailure: boolean, thisFeatureOK: boolean };
export type TStartFeature = { resolvedFeature: TResolvedFeature, index: number };
export type TStartScenario = { scopedVars: FeatureVariables };
export type TBeforeStep = { featureStep: TFeatureStep };
export type TAfterStep = { featureStep: TFeatureStep, actionResult: TStepActionResult };
export type TFailureArgs = { featureResult: TFeatureResult, failedStep: TStepResult };
export type TAfterStepResult = { rerunStep?: boolean, nextStep?: boolean, failed: boolean };

export const CycleWhen = {
	FIRST: -999,
	LAST: 999
};

// ============================================================================
// Domains
// ============================================================================

export type TDomainCoercer = (proto: TStepValue, featureStep?: TFeatureStep, steppers?: AStepper[]) => TStepValueValue;
export type TDomainComparator = (value: TStepValueValue, baseline: TStepValueValue) => number;

export type TDomainDefinition = {
	selectors: string[];
	schema: ZodTypeAny;
	coerce?: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
};

export type TRegisteredDomain = {
	selectors: string[];
	schema: ZodTypeAny;
	coerce: TDomainCoercer;
	comparator?: TDomainComparator;
	values?: string[];
	description?: string;
};

// ============================================================================
// Misc
// ============================================================================

export enum ExecMode {
	WITH_CYCLES = 'WITH_CYCLES',
	NO_CYCLES = 'NO_CYCLES',
	PROMPT = 'PROMPT',
}

export type TOptionValue = TAnyFixme;
export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};
