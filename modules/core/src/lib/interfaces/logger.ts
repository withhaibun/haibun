import { TAnyFixme, TStepResult, TTag } from '../defs.js';

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export type TLogArgs = string;
export const TEST_RESULT = { ok: true };

export type TLogHistory = { message: TLogArgs; messageContext: TMessageContext; level: TLogLevel, caller: string };

export type TExecutorTopic = {
  result: TStepResult | typeof TEST_RESULT;
  seq: number;
  stage: 'Executor';
};

export type TTraceTopic = {
  type?: string;
  trace?: object;
};

export type TMessageTopic = TExecutorTopic | TTraceTopic;

// FIXME better articulate these
export type TMessageContext = {
  topic?: TMessageTopic;
  tag?: TTag;
  artifact?: TArtifact;
};

export type TArtifact = {
  type: 'picture' | 'html' | 'video' | 'json';
  event: 'failure' | 'request';
  path?: string;
  content?: TAnyFixme;
};

export interface ILogger {
  debug: (what: TLogArgs, ctx?: TMessageContext) => void;
  log: (what: TLogArgs, ctx?: TMessageContext) => void;
  info: (what: TLogArgs, ctx?: TMessageContext) => void;
  warn: (what: TLogArgs, ctx?: TMessageContext) => void;
  error: (what: TLogArgs, ctx?: TMessageContext) => void;
  addSubscriber: (subscriber: ILogOutput) => void;
}

export interface IConnect {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  addKeepalive?: (keepalive: TAnyFixme) => void;
}

export interface IConnectedLogger extends ILogger, IConnect {}

export interface ILoggerKeepAlive {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface ILogOutput {
  out: (level: TLogLevel, args: TLogArgs, ctx?: TMessageContext) => void;
}

export type TOutputEnv = { output: ILogOutput; tag: TTag };

export type TMessage = { level: string; message: string; messageTopic?: TMessageTopic };
// FIXME get rid of result
export type TMessageWithTopic = { level: string; message: string; messageTopic: { result: TStepResult } };
