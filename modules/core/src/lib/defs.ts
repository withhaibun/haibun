import { AStepper } from './astepper.js';
import { ILogger, TArtifact, TMessageContext } from './interfaces/logger.js';
import { TAnyFixme } from './fixme.js';
import { Timer } from './Timer.js';
import { TTag } from './ttag.js';
import { FeatureVariables } from './feature-variables.js';

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
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
	timer: Timer;
	bases: TBase;
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
			seq: 0,
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
	seq: number;
	action: TStepAction;
};

export type TAction = (named: TNamed, featureStep: TFeatureStep) => Promise<TActionResult>;

export type TStepperStep = {
	match?: RegExp;
	gwta?: string;
	exact?: string;
	action: TAction;
	applyEffect?: TApplyEffect;
};

export type TApplyEffect = (named: TNamed, featureStep: TFeatureStep, steppers: AStepper[]) => Promise<TFeatureStep[]>;

export interface CStepper {
	new(): AStepper;
	prototype: {
		steps: {
			[name: string]: TStepperStep;
		};
		setWorld(world: TWorld, steppers: AStepper[]): Promise<void>;
		getWorld(): TWorld;
	};
}

export type TSteppers = {
	[name: string]: AStepper;
};

export type TEndFeature = { world: TWorld, shouldClose: boolean, isLast: boolean, okSoFar: boolean, continueAfterError: boolean, stayOnFailure: boolean, thisFeatureOK: boolean };
export type TStartFeature = TResolvedFeature;

export interface IStepperCycles {
	startExecution?(): Promise<void>;
	startFeature?(feature: TStartFeature): Promise<void>;
	endFeature?(endedWith?: TEndFeature): Promise<void>;
	onFailure?(result: TStepResult, step: TFeatureStep): Promise<void | TMessageContext>;
	endExecution?(): Promise<void>
}
export type TStepAction = {
	actionName: string;
	stepperName: string;
	step: TStepperStep;
	named?: TNamed | undefined;
	vars?: TNamedVar[];
};

export type TNamed = { [name: string]: string };
export type TNamedVar = { name: string; type: string };

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
	artifact?: TArtifact
};

export type TNotOKActionResult = {
	ok: false;
	message: string;
	messageContext?: TMessageContext;
	artifact?: TArtifact
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
	actionResult: TStepActionResult;
	in: string;
	path: string;
	seq: number;
};

export type TRuntime = { [name: string]: TAnyFixme };

export const HAIBUN = 'HAIBUN';
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = 'capture';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export const STAY_ALWAYS = 'always';
export const STAY_FAILURE = 'failure';
export const STAY = 'STAY';

export const CHECK_YES = '✅';
export const CHECK_NO = '❌';

export const STEP_DELAY = 'STEP_DELAY';
export const DEFAULT_DEST = 'default';
export const CONTINUE_AFTER_ERROR = 'CONTINUE_AFTER_ERROR'; export const SCENARIO_START = 'scenarioStart';


