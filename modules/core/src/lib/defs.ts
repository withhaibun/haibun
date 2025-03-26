import { WorkspaceContext, WorldContext } from './contexts.js';
import { ILogger, TMessageContext } from './interfaces/logger.js';
import { Timer } from './Timer.js';
import { constructorName } from './util/index.js';

export type TSpecl = {
	steppers: string[];
	refs?: {
		docs: { [name: string]: { src: string } };
	};
	options: TOptions;
};

type TBaseOptions = {
	DEST: string;
};

export type TOptions = TBaseOptions & {
	[name: string]: TOptionValue;
};

export type TOptionValue = TAnyFixme;

export interface IHasOptions {
	options?: {
		[name: string]: {
			required?: boolean;
			// alternate for the literal option
			altSource?: string;
			default?: string;
			desc: string;
			parse: (input: string, existing?: TOptionValue) => { error?: string; env?: TOptions; result?: TAnyFixme };
		};
	};
}

export const HANDLER_USAGE = {
	EXCLUSIVE: 'exclusive',
	FALLBACK: 'fallback',
} as const;

export type THandlerUsage = (typeof HANDLER_USAGE)[keyof typeof HANDLER_USAGE];
export interface IHandler {
	usage?: THandlerUsage;
	// eslint-disable-next-line @typescript-eslint/ban-types
	handle: Function;
}
export interface ISourcedHandler extends IHandler {
	stepper: AStepper;
}

export type THandlers = {
	[handlesName: string]: IHandler;
};
export interface IHasHandlers extends AStepper {
	handlers: THandlers;
}

export const isHasHandlers = (s: IHasHandlers): s is IHasHandlers => s.handlers !== undefined;

export interface IHasBuilder {
	finalize: (workspace: WorkspaceContext) => void;
}
export type TModuleOptions = { [name: string]: string };
export type TProtoOptions = {
	options: TOptions;
	moduleOptions: TModuleOptions;
};

export type TBase = string[];

export type TWorld = {
	tag: TTag;
	shared: WorldContext;
	runtime: TRuntime;
	logger: ILogger;
	options: TOptions;
	moduleOptions: TModuleOptions;
	timer: Timer;
	bases: TBase;
};

export type TFeatureMeta = {
	type: string;
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

export type TResolvedFeature = TExpandedFeature & {
	name: string;
	featureSteps: TFeatureStep[];
};

const example: TResolvedFeature = {
	type: 'feature',
	path: 'path',
	base: 'base',
	name: 'name',
	expanded: [{ line: 'line', feature: { type: 'type', base: 'base', name: 'name', path: 'path', content: 'content' } }],
	featureSteps: [
		{
			source: { type: 'type', base: 'base', name: 'name', path: 'path', content: 'content' },
			in: 'in',
			seq: 0,
			action: {
				actionName: 'actionName',
				stepperName: 'stepperName',
				step: { action: async () => OK },
			},
		},
	],
};

export type TTagValue = number;
export type TTag = {
	key: string;
	sequence: number;
	featureNum: number;
	params: TAnyFixme;
	trace: boolean;
};

export type TFeatureStep = {
	source: TFeature;
	in: string;
	seq: number;
	action: TStepAction;
};

export type TAction = (named: TNamed, featureStep: TFeatureStep) => Promise<TActionResult>;

export type TRequiresResult = { includes?: string[] };

export type TFinalize = (workspace: WorkspaceContext) => void;

export abstract class WorkspaceBuilder {
	constructor(private name: string) { }
	abstract addControl(...args: TAnyFixme);
	abstract finalize(): TAnyFixme;
}

export type TStepperStep = {
	match?: RegExp;
	gwta?: string;
	exact?: string;
	action: TAction;
	applyEffect?: TApplyEffect;
};

export type TApplyEffect = (named: TNamed, resolvedFeatures: TResolvedFeature[]) => Promise<TResolvedFeature[]>;

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

// punt any type problems
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TAnyFixme = any;

export type TSteppers = {
	[name: string]: AStepper;
};

export abstract class AStepper {
	world?: TWorld;
	startExecution?(): Promise<void>;
	startFeature?(): Promise<void>;
	endFeature?(): Promise<void>;
	endedFeature?(): void;
	onFailure?(result: TStepResult, step: TFeatureStep): Promise<void | TMessageContext>;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async setWorld(world: TWorld, steppers: AStepper[]) {
		this.world = world;
	}
	abstract steps: { [name: string]: TStepperStep };
	getWorld() {
		if (!this.world) {
			throw Error(`stepper without world ${constructorName(this)}`);
		}

		return this.world;
	}
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
	shared: WorldContext;
	topics?: TActionResultTopics;
	featureResults?: TFeatureResult[];
	failure?: {
		stage: string;
		error: TExecutorResultError;
	};
};

export type TOKActionResult = {
	ok: true;
	topics?: TActionResultTopics;
};

export type TActionResultTopics = {
	[topic: string]: { summary: string; details?: TAnyFixme; report?: { html?: string; image?: string; video?: string } };
};

export type TNotOKActionResult = {
	ok: false;
	message: string;
	error?: Error;
	topics?: TActionResultTopics;
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
	sourcePath: string;
	seq: number;
};

export type TRuntime = { [name: string]: TAnyFixme };

export interface IResultOutput {
	writeOutput(result: TExecutorResult, args: TAnyFixme): Promise<TAnyFixme>;
}

export const HAIBUN = 'HAIBUN';
export const BASE_PREFIX = `${HAIBUN}_`;
export const CAPTURE = 'capture';
export const DEFAULT_DEST = 'default';

export const BASE_DOMAINS = [{ name: 'string', resolve: (inp: string) => inp }];

export type TEndFeatureCallbackParams = { world: TWorld; result: TFeatureResult; steppers: AStepper[]; startOffset: number };
export type TEndFeatureCallback = (params: TEndFeatureCallbackParams) => Promise<void>;

export const STAY_ALWAYS = 'always';
export const STAY_FAILURE = 'failure';
export const STAY = 'STAY';

export const CHECK_YES = '✅';
export const CHECK_NO = '❌';

export const STEP_DELAY = 'STEP_DELAY';
