import { TAnyFixme } from '../fixme.js';
import { TTag } from '../ttag.js';

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export type TLogArgs = string;

export type TMessageContext = {
	incident: EExecutionMessageType;
	artifact?: TArtifact;
	incidentDetails?: TAnyFixme;
	tag?: TTag;
};

export type TLogHistory = {
	message: TLogArgs;
	level: TLogLevel;
	caller: string;
	messageContext: TMessageContext
};

export enum EExecutionMessageType {
	INIT = 'INIT',
	EXECUTION_START = 'EXECUTION_START',
	FEATURE_START = 'FEATURE_START',
	SCENARIO_START = 'SCENARIO_START',
	STEP_START = 'STEP_START',
	STEP_NEXT = 'STEP_NEXT',
	ACTION = 'ACTION',
	TRACE = 'TRACE',
	STEP_END = 'STEP_END',
	SCENARIO_END = 'SCENARIO_END',
	FEATURE_END = 'FEATURE_END',
	EXECUTION_END = 'EXECUTION_END',
	ON_FAILURE = 'ON_FAILURE',
}

export interface ILogger {
	debug: (what: TLogArgs, ctx?: TMessageContext) => void;
	log: (what: TLogArgs, ctx?: TMessageContext) => void;
	info: (what: TLogArgs, ctx?: TMessageContext) => void;
	warn: (what: TLogArgs, ctx?: TMessageContext) => void;
	error: (what: TLogArgs, ctx?: TMessageContext) => void;
	addSubscriber: (subscriber: ILogOutput) => void;
	removeSubscriber: (subscriber: ILogOutput) => void;
}

export interface ILogOutput {
	out: (level: TLogLevel, args: TLogArgs, ctx?: TMessageContext) => void;
}

export type TOutputEnv = { output: ILogOutput; tag: TTag };

export type TArtifact = (
	TArtifactSpeech |
	TArtifactVideo |
	TArtifactVideoStart |
	TArtifactImage |
	TArtifactHTML |
	TArtifactJSON |
	TArtifactHTTPTrace
);

export type TArtifactSpeech = {
	artifactType: 'speech';
	transcript: string;
	durationS: number;
	path: string;
	runtimePath: string;
};

export type TArtifactVideo = {
	artifactType: 'video';
	path: string;
	runtimePath: string;
};

export type TArtifactVideoStart = {
	artifactType: 'video/start';
	start: number;
};
export type TArtifactImage = {
	artifactType: 'image';
	path: string;
	runtimePath: string;
};
export type TArtifactHTML = {
	artifactType: 'html';
	html: string;
};
export type TArtifactJSON = {
	artifactType: 'json';
	json: object;
};
export type TArtifactHTTPTrace = {
	artifactType: 'json/http/trace';
	httpEvent: 'response' | 'request' | 'route';
	trace: THTTPTraceContent;
};

export type TArtifactType = TArtifact['artifactType'];

export type THTTPTraceContent = {
	frameURL?: string;
	requestingPage?: string;
	requestingURL?: string;
	method?: string;
	headers?: Record<string, string>;
	postData?: unknown;
	status?: number;
	statusText?: string;
}
