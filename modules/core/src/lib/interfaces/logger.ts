import { TAnyFixme, TStepResult, TTag, TFeatureStep, versionedSchema } from '../defs.js';

export type TLogLevel = 'none' | 'debug' | 'log' | 'info' | 'warn' | 'error';
export type TLogArgs = string;

export type TLogHistory = {
  message: TLogArgs;
  level: TLogLevel;
  caller: string;
  messageContext: TMessageContext
};

export const SCHEMA_HISTORY_WITH_META = versionedSchema('HistoryWithMeta');

export type THistoryWithMeta = {
    '$schema': typeof SCHEMA_HISTORY_WITH_META;
    meta: {
        startTime: string;
        description: string;
        feature: string,
        startOffset: number;
        ok: boolean;
    };
    logHistory: TLogHistory[];
};


export type TMessageContext = TArtifactMessageContext | TExecutorMessageContext | TTraceMessageContext | TBasicMessageContext;

type TContextTopic = TArtifactRequestStepTopic | TArtifactFailureStepTopic | TExecutorResultTopic | TTraceTopic;

export type TLogHistoryWithArtifact = TLogHistory & {
  messageContext: TArtifactMessageContext
};

export type TArtifactMessageContext = {
  topic: TArtifactRequestStepTopic | TArtifactSummaryTopic | TArtifactFailureStepTopic | TArtifactDebugTopic,
  artifact: TArtifact;
  tag?: TTag;
};

export type TBasicMessageContext = {
  tag: TTag;
};

export type TExecutorMessageContext = {
  topic: TExecutorResultTopic;
  tag: TTag;
};

export type TTraceMessageContext = {
  topic: TTraceTopic;
  tag: TTag;
};

export type TExecutorResultTopic = {
  result: TStepResult, 
  step: TFeatureStep,
  stage: 'Executor';
};

export type TActionStage = 'endFeature' | 'action' | 'onFailure' | 'nextStep' | 'init' | 'action';

type TBaseArtifactTopic = {
  stage: TActionStage
};

export type TArtifactSummaryTopic = TBaseArtifactTopic & {
  event: 'summary';
};

export type TArtifactRequestStepTopic = TBaseArtifactTopic & {
  event: 'request';
  seq: number;
};

export type TArtifactDebugTopic = TBaseArtifactTopic & {
  event: 'debug';
};

export type TArtifactFailureStepTopic = TBaseArtifactTopic & {
  event: 'failure';
  step: TFeatureStep;
};


export type TTraceTopic = {
  type?: string;
  trace?: object;
};

export type TLogHistoryWithExecutorTopic = TLogHistory & {
  messageContext: {
    topic: TExecutorResultTopic;
    tag: TTag;
  };
};

export type TArtifact = {
  type: 'video' | 'picture' | 'html' | 'json' | 'json/playwright/trace';
  path?: string;
  content?: TAnyFixme;
};

export type TArtifactType = TArtifact['type'];

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

export type TMessage = { level: string; message: string; messageTopic?: TContextTopic };
// FIXME get rid of result
export type TMessageWithTopic = { level: string; message: string; messageTopic: { result: TStepResult } };
