import { TAnyFixme, TTag } from '../defs.js';
import { TMessageContext } from './messageContexts.js';
export type * from './messageContexts.d.ts';
export type * from './artifacts.d.ts'

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export type TLogArgs = string;

export type TLogHistory = {
	message: TLogArgs;
	level: TLogLevel;
	caller: string;
	messageContext: TMessageContext
};

export type TActionStage = 'endFeature' | 'action' | 'onFailure' | 'nextStep' | 'init' | 'action';

export interface ILogger {
	debug: (what: TLogArgs, ctx?: TMessageContext) => void;
	log: (what: TLogArgs, ctx?: TMessageContext) => void;
	info: (what: TLogArgs, ctx?: TMessageContext) => void;
	warn: (what: TLogArgs, ctx?: TMessageContext) => void;
	error: (what: TLogArgs, ctx?: TMessageContext) => void;
	addSubscriber: (subscriber: ILogOutput) => void;
	removeSubscriber: (subscriber: ILogOutput) => void;
}

export interface IConnect {
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
	addKeepalive?: (keepalive: TAnyFixme) => void;
}

export interface IConnectedLogger extends ILogger, IConnect { }

export interface ILoggerKeepAlive {
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

export interface ILogOutput {
	out: (level: TLogLevel, args: TLogArgs, ctx?: TMessageContext) => void;
}

export type TOutputEnv = { output: ILogOutput; tag: TTag };
