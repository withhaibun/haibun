import { AStepper } from './astepper.js';
import { ILogger, TArtifact, TMessageContext } from './interfaces/logger.js';
import { TAnyFixme } from './fixme.js';
import { Timer } from './Timer.js';
import { TTag } from './ttag.js';
import { FeatureVariables } from './feature-variables.js';
import { Prompter } from './prompter.js';

export type TSpecl = {
	steppers: string[];
	refs?: {
		docs: { [name: string]: { src: string } };
	};
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

export type TOptionValue = TAnyFixme;


export type TModuleOptions = { [name: string]: string };
export type TProtoOptions = {
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
};

export type TBase = string[];

export type TWorld = {
	tag: TTag;
	shared: FeatureVariables;
	runtime: TRuntime;
	logger: ILogger;
	prompter: Prompter;
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
	timer: Timer;
	bases: TBase;
	domains: Record<string, { coerce: TDomainCoercer }>;
};

export type TFeatureMeta = {
	base: string;
	name: string;
	path: string;
};
export type TFeature = TFeatureMeta & {
	name: string;
	content: string;
};

export type TExpandedFeature = TFeatureMeta & {
	name: string;
	expanded: TExpandedLine[];
};

export type TExpandedLine = {
	line: string;
	feature: TFeature;
};

export type TFeatures = TFeature[];

export type TResolvedFeature = {
	path: string;
	base: string;
	name: string;
	featureSteps: TFeatureStep[];
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const example: TResolvedFeature = {
	path: 'path',
	base: 'base',
	name: 'name',
	featureSteps: [
		{
			path: 'path',
			in: 'in',
			seqPath: [0],
			action: {
				actionName: 'actionName',
				stepperName: 'stepperName',
				step: { action: async () => await Promise.resolve(OK) },
			},
		},
	],
};

export type TFeatureStep = {
	path: string;
	in: string;
	seqPath: TSeqPath;
	action: TStepAction;
};

export type TSeqPath = number[];
export type TStepArgs = Record<string, TStepValueValue>;

export type TAction = (args: TStepArgs, featureStep: TFeatureStep) => Promise<TActionResult> | TActionResult;

export type TStepperStep = {
	description?: string;
	precludes?: string[];
	unique?: boolean;
	expose?: boolean;
	virtual?: boolean;
	match?: RegExp;
	gwta?: string;
	exact?: string;
	resolveFeatureLine?(line: string, path: string, stepper: AStepper, backgrounds: TFeatures, allLines?: string[], lineIndex?: number): boolean | void;
	// FIXME Using method syntax for bivariant parameter checking for action
	action(args: TStepArgs, featureStep?: TFeatureStep): Promise<TActionResult> | TActionResult;
}

export interface CStepper {
	new(): AStepper;
}

export type TSteppers = {
	[name: string]: AStepper;
};

export type TEndFeature = { shouldClose: boolean, isLast: boolean, okSoFar: boolean, continueAfterError: boolean, stayOnFailure: boolean, thisFeatureOK: boolean };
export type TStartFeature = { resolvedFeature: TResolvedFeature, index: number };
export type TStartExecution = TResolvedFeature[]
export type TStartScenario = { featureVars: FeatureVariables };
export type TBeforeStep = { featureStep: TFeatureStep };
export type TAfterStep = { featureStep: TFeatureStep, actionResult: TStepActionResult };
export type TFailureArgs = { featureResult: TFeatureResult, failedStep: TStepResult };

export type TAfterStepResult = { rerunStep?: boolean, nextStep?: boolean, failed: boolean };
export interface IStepperCycles {
	getDomains?(): TDomainDefinition[];
	startExecution?(features: TStartExecution): Promise<void>;
	startFeature?(startFeature: TStartFeature): Promise<void> | void;
	startScenario?(startScenario: TStartScenario): Promise<void>;
	beforeStep?(beforeStep: TBeforeStep): Promise<void>;
	afterStep?(afterStep: TAfterStep): Promise<TAfterStepResult>;
	endScenario?(): Promise<void>;
	endFeature?(endedWith?: TEndFeature): Promise<void>;
	onFailure?(result: TFailureArgs): Promise<void | TMessageContext>;
	endExecution?(): Promise<void>;
}

export type TDomainCoercer = (proto: TStepValue, featureStep?: TFeatureStep, steppers?: AStepper[]) => TStepValueValue;

export type TDomainDefinition = {
	selectors: string[];
	coerce: TDomainCoercer
};

export type StepperMethodArgs = {
	[K in keyof IStepperCycles]: Parameters<NonNullable<IStepperCycles[K]>>[0];
};
export type TStepValuesMap = Record<string, TStepValue>;

export type TStepAction = {
	actionName: string;
	stepperName: string;
	step: TStepperStep;
	stepValuesMap?: TStepValuesMap;
};

export enum Origin {
	fallthrough = 'fallthrough',
	var = 'var',
	env = 'env',
	quoted = 'quoted',
	statement = 'statement', // DOMAIN_STATEMENT
}

export type TOrigin = keyof typeof Origin;
export type TProvenanceIdentifier = { in?: string; seq: number[], when: string };

// FIXME: set of by domain value types
export type TStepValueValue = unknown;

export type TStepValue = {
	term: string;
	domain: string;
	value?: TStepValueValue;
	origin: TOrigin;
	provenance?: TProvenanceIdentifier[]
};

export const OK: TOKActionResult = { ok: true };

export type TExecutorResultError = {
	details: {
		[name: string]: TAnyFixme;
		stack: string[];
	};
	message: string;
};

export type TExecutorResult = {
	ok: boolean;
	tag: TTag;
	shared: FeatureVariables;
	featureResults?: TFeatureResult[];
	failure?: {
		stage: string;
		error: TExecutorResultError;
	};
	steppers: AStepper[];
};

export type TOKActionResult = {
	ok: true;
	messageContext?: TMessageContext;
	artifact?: TArtifact;
};

export type TNotOKActionResult = {
	ok: false;
	message: string;
	messageContext?: TMessageContext;
	artifact?: TArtifact;
};

export type TTrace = {
	[name: string]: {
		url: string;
		since: number;
		trace: TAnyFixme;
	};
};

export type TTraces = {
	start?: number;
	// FIXME following should not be optional
	end?: number;
	traces?: TTrace[];
};

export type TTraceOptions = {
	[event: string]: {
		listener: TAnyFixme;
	};
};

export type TActionResult = TOKActionResult | TNotOKActionResult;

export type TStepActionResult = (TNotOkStepActionResult | TOKStepActionResult) & TTraces;

type TNamedStepActionResult = {
	name: string;
};

export type TNotOkStepActionResult = TNotOKActionResult & TNamedStepActionResult;

export type TOKStepActionResult = TOKActionResult & TNamedStepActionResult;

export type TFeatureResult = {
	skip?: boolean;
	path: string;
	ok: boolean;
	stepResults: TStepResult[];
	failure?: TFeatureResultFailure;
};

export type TFeatureResultFailure = {
	message: string;
	error: TAnyFixme;
	expected?: TAnyFixme;
};

export type TStepResult = {
	ok: boolean;
	stepActionResult: TStepActionResult;
	in: string;
	path: string;
	seqPath: TSeqPath;
};

export type TSatisfiedOutcome = {
	proofResult: TStepResult;
};

export type TRuntime = {
	backgrounds?: TFeature[];
	stepResults: TStepResult[];
	// activities-stepper
	satisfiedOutcomes?: { [outcome: string]: TSatisfiedOutcome };
	[name: string]: TAnyFixme;
};
export const HAIBUN = 'HAIBUN';
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = 'capture';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export const STAY_ALWAYS = 'always';
export const STAY_FAILURE = 'failure';
export const STAY = 'STAY';

export const CHECK_YES = '✅';
export const CHECK_NO = '❌';
export const CHECK_YIELD = '🔀'
export const MAYBE_CHECK_YES = '✓';
export const MAYBE_CHECK_NO = '✗';

export const STEP_DELAY = 'STEP_DELAY';
export const DEFAULT_DEST = 'default';
export const TEST_BASE = 'test_base';
export const CONTINUE_AFTER_ERROR = 'CONTINUE_AFTER_ERROR';
export const SCENARIO_START = 'scenario';
export const HAPPENING_START = 'happening';

export enum ExecMode {
	WITH_CYCLES = 'WITH_CYCLES',
	NO_CYCLES = 'NO_CYCLES',
	PROMPT = 'PROMPT',
}
