import { TStepResult, TTag } from '../defs.js';

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export type TLogArgs = string;
export const TEST_RESULT = { _test: true };

export type TExecutorTopic = {
  result: TStepResult | typeof TEST_RESULT;
  seq: number;
  stage: 'Executor';
};
// currently there is just the Executor instance
export type TMessageContext = {
  topic?: TMessageTopic;
  tag?: TTag;
};

export type TTraceTopic = {
  type?: string;
  trace?: boolean;
};
export type TMessageTopic = TExecutorTopic | TTraceTopic;

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
  addKeepalive?: (keepalive: any) => void;
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
